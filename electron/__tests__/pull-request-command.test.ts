import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import {
  createTemporaryDirectory,
  createTemporaryEnvironment,
} from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { GH_NOT_FOUND_CODE, getGhCommand, submitPullRequestReview } =
  require('../git-state/pull-request.cjs') as {
    GH_NOT_FOUND_CODE: string;
    getGhCommand: () => string;
    submitPullRequestReview: (
      launchPath: string,
      request: {
        body?: string;
        comments: ReadonlyArray<Record<string, unknown>>;
        event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
        source: {
          provider: 'github';
          type: 'pull-request';
          url: string;
        };
      },
    ) => Promise<void>;
  };

const execFileAsync = promisify(execFile);

test('resolves the GitHub CLI from an explicit override', async () => {
  await using directory = await createTemporaryDirectory('codiff-gh-command-');
  const fakeGh = join(directory.path, 'gh');
  await writeFile(fakeGh, '#!/bin/sh\nexit 0\n');
  await chmod(fakeGh, 0o755);

  await using _environment = createTemporaryEnvironment({ CODIFF_GH_PATH: fakeGh });

  expect(getGhCommand()).toBe(fakeGh);
});

test('rejects invalid explicit GitHub CLI overrides', async () => {
  await using _environment = createTemporaryEnvironment({
    CODIFF_GH_PATH: '/tmp/codiff-missing-gh',
  });

  expect(() => getGhCommand()).toThrow('CODIFF_GH_PATH');
  try {
    getGhCommand();
  } catch (error) {
    expect(error).toMatchObject({ code: GH_NOT_FOUND_CODE });
  }
});

test('falls back to a standard install directory when gh is off PATH', async () => {
  await using directory = await createTemporaryDirectory('codiff-gh-fallback-');
  const localBin = join(directory.path, '.local/bin');
  const emptyBin = join(directory.path, 'empty-bin');
  const fallbackGh = join(localBin, 'gh');

  await Promise.all([mkdir(localBin, { recursive: true }), mkdir(emptyBin)]);
  await writeFile(fallbackGh, '#!/bin/sh\nexit 0\n');
  await chmod(fallbackGh, 0o755);

  await using _environment = createTemporaryEnvironment({
    CODIFF_GH_PATH: undefined,
    HOME: directory.path,
    PATH: emptyBin,
  });

  expect(getGhCommand()).toBe(fallbackGh);
});
