import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { createTemporaryDirectory } from './helpers/resources.ts';

const execute = promisify(execFile);

test.each(['node', 'packaged'])(
  '%s CLI ignores old update caches and omits the update command',
  async (kind) => {
    await using home = await createTemporaryDirectory('codiff-no-updates-');
    const configDir = join(home.path, '.codiff');
    await mkdir(configDir);
    await writeFile(
      join(configDir, 'codiff.jsonc'),
      JSON.stringify({ settings: { checkForUpdates: true } }),
    );
    await writeFile(
      join(configDir, 'update-state.json'),
      JSON.stringify({
        compatible: true,
        lastCheckedAt: new Date().toISOString(),
        latestVersion: '999.0.0',
      }),
    );
    const command = kind === 'node' ? process.execPath : resolve('bin/codiff-app');
    const args = kind === 'node' ? [resolve('bin/codiff.js')] : [];
    const options = { env: { ...process.env, HOME: home.path } };
    const version = await execute(command, [...args, '--version'], options);
    expect(version.stdout).toMatch(/^codiff v[\d.]+\n$/);
    expect(version.stderr).toBe('');
    const help = await execute(command, [...args, '--help'], options);
    expect(help.stdout.toLowerCase()).not.toContain('update');
    expect(help.stderr).toBe('');
  },
);
