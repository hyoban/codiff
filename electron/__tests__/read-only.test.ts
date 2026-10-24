import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vite-plus/test';
import { getGitTestEnvironmentForSubprocess } from '../../core/__tests__/helpers/git.ts';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';
const require = createRequire(import.meta.url);
const { readRepositoryState, listRepositoryHistory } = require('../git-state.cjs');
const { resolvePullRequestContentRefs } = require('../git-state/pull-request.cjs');
const exec = promisify(execFile);
const snapshot = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      const info = await stat(path);
      result[path.slice(root.length)] = `${info.mtimeMs}:${createHash('sha256')
        .update(await readFile(path))
        .digest('hex')}`;
    }
  }
  return result;
};
test('reading local changes, history and PR context leaves files, index and refs untouched', async () => {
  await using directory = await createTemporaryDirectory('codiff-read-only-');
  const root = directory.path;
  const git = (...args: string[]) =>
    exec('git', ['-C', root, ...args], { env: getGitTestEnvironmentForSubprocess() });
  await git('init');
  await writeFile(join(root, 'file.md'), '# Original\n');
  await git('add', '.');
  await git('commit', '-m', 'Initial.');
  const head = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'file.md'), '# Updated\n');
  await writeFile(join(root, 'new.txt'), 'Untracked\n');
  const before = await snapshot(root);
  const state = await readRepositoryState(root);
  expect(state.files.map((file: { path: string }) => file.path)).toEqual(['file.md', 'new.txt']);
  expect((await listRepositoryHistory(root)).entries).toHaveLength(1);
  expect(
    await resolvePullRequestContentRefs(
      root,
      { number: 1 },
      { base: { sha: head }, head: { sha: head } },
    ),
  ).toEqual({ base: head, head });
  expect(
    await resolvePullRequestContentRefs(
      root,
      { number: 1 },
      { base: { sha: head }, head: { sha: 'f'.repeat(40) } },
    ),
  ).toBeNull();
  expect(await snapshot(root)).toEqual(before);
});
test('the renderer bridge exposes no repository or remote mutation APIs', async () => {
  let bridge: Record<string, unknown> = {};
  const source = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
  runInNewContext(source, {
    document: { documentElement: { setAttribute() {} } },
    localStorage: { length: 0 },
    sessionStorage: { length: 0 },
    process: { platform: 'darwin' },
    require: () => ({
      contextBridge: {
        exposeInMainWorld(_name: string, api: Record<string, unknown>) {
          bridge = api;
        },
      },
      ipcRenderer: { invoke: async () => ({}) },
    }),
  });
  for (const key of [
    'createCommit',
    'saveRepositoryFile',
    'saveMarkdownDocument',
    'submitPullRequestComment',
    'submitPullRequestReview',
    'sharePlan',
    'completePlan',
  ]) {
    expect(bridge).not.toHaveProperty(key);
  }
  expect(bridge).toHaveProperty('openFile');
  expect(bridge).toHaveProperty('getRepositoryState');
  expect(bridge).toHaveProperty('onCopyPendingCommentsRequest');
});
