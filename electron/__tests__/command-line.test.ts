import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { getGitTestEnvironment } from '../../core/__tests__/helpers/git.ts';
import {
  createTemporaryDirectory,
  createTemporaryEnvironment,
  createTemporaryWorkingDirectory,
} from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { getCommandLineLaunchOptions, getCommandLineRepositoryPath, getInitialRepositoryPath } =
  require('../main/command-line.cjs') as {
    getCommandLineLaunchOptions: (
      commandLine: ReadonlyArray<string>,
      fallbackPath?: string,
    ) => {
      planFile?: string;
      planResultFile?: string;
      repositoryPathProvided: boolean;
      source?:
        | { ref: string; type: 'branch-working-tree' }
        | { ref: string; type: 'commit' }
        | { base: string; head: string; symmetric: boolean; type: 'range' }
        | { type: 'pull-request'; url: string };
    };
    getCommandLineRepositoryPath: (commandLine: ReadonlyArray<string>) => string | null;
    getInitialRepositoryPath: (
      launchPath: string,
      launchOptions: {
        planFile?: string;
        planResultFile?: string;
        repositoryPathProvided: boolean;
        source?:
          | { ref: string; type: 'branch-working-tree' }
          | { ref: string; type: 'commit' }
          | { base: string; head: string; symmetric: boolean; type: 'range' }
          | { type: 'pull-request'; url: string };
      },
      lastRepositoryPath: string,
      environment?: NodeJS.ProcessEnv,
    ) => string;
  };

const readCommandLine = (commandLine: ReadonlyArray<string>) => ({
  launchOptions: getCommandLineLaunchOptions(commandLine),
  pullRequestNumber: null,
  repositoryPath: getCommandLineRepositoryPath(commandLine),
});

const execFileAsync = promisify(execFile);

const git = async (repo: string, args: ReadonlyArray<string>) => {
  await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: getGitTestEnvironment(),
  });
};

const defaultLaunchOptions = {
  repositoryPathProvided: false,
};

test('plan command lines do not inspect Git refs', { concurrent: false }, async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-command-line-');
  const fakeBin = join(directory.path, 'bin');
  const gitMarker = join(directory.path, 'git-invoked');
  const planFile = join(directory.path, 'plan.md');
  await using _environment = createTemporaryEnvironment({
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
  });

  await mkdir(fakeBin);
  await writeFile(planFile, '# Plan\n');
  await writeFile(join(fakeBin, 'git'), `#!/bin/sh\nprintf invoked > "${gitMarker}"\nexit 99\n`);
  await chmod(join(fakeBin, 'git'), 0o755);

  expect(readCommandLine(['codiff', '--plan-file', planFile, 'workspace'])).toMatchObject({
    launchOptions: {
      planFile,
      repositoryPathProvided: true,
    },
    repositoryPath: 'workspace',
  });
  expect(await readFile(gitMarker, 'utf8').catch(() => null)).toBeNull();
});

test('parses plan handoff command-line options', () => {
  expect(
    readCommandLine([
      'codiff',
      '--plan-file',
      '/tmp/plan.md',
      '--plan-result-file',
      '/tmp/result.json',
      '/repo',
    ]),
  ).toMatchObject({
    launchOptions: {
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    },
    repositoryPath: '/repo',
  });
});

test('parses positional HEAD revisions as commit sources', () => {
  expect(readCommandLine(['codiff', 'HEAD'])).toEqual({
    launchOptions: {
      repositoryPathProvided: false,
      source: {
        ref: 'HEAD',
        type: 'commit',
      },
    },
    pullRequestNumber: null,
    repositoryPath: null,
  });

  expect(readCommandLine(['codiff', 'HEAD^1', '/repo'])).toEqual({
    launchOptions: {
      repositoryPathProvided: true,
      source: {
        ref: 'HEAD^1',
        type: 'commit',
      },
    },
    pullRequestNumber: null,
    repositoryPath: '/repo',
  });
});

test('parses plain refs as branch sources', async () => {
  await using directory = await createTemporaryDirectory('codiff-branch-ref-');
  await git(directory.path, ['init']);
  await git(directory.path, ['commit', '--allow-empty', '-m', 'initial commit']);
  await git(directory.path, ['checkout', '-b', 'feature']);
  await using _cwd = createTemporaryWorkingDirectory(directory.path);

  expect(readCommandLine(['codiff', 'feature'])).toEqual({
    launchOptions: {
      repositoryPathProvided: false,
      source: {
        ref: 'feature',
        type: 'branch-working-tree',
      },
    },
    pullRequestNumber: null,
    repositoryPath: null,
  });

  expect(readCommandLine(['codiff', 'feature', directory.path])).toEqual({
    launchOptions: {
      repositoryPathProvided: true,
      source: {
        ref: 'feature',
        type: 'branch-working-tree',
      },
    },
    pullRequestNumber: null,
    repositoryPath: directory.path,
  });
});

test('parses missing plain refs in Git repositories as branch sources', async () => {
  await using directory = await createTemporaryDirectory('codiff-missing-branch-ref-');
  await git(directory.path, ['init']);
  await git(directory.path, ['commit', '--allow-empty', '-m', 'initial commit']);
  await using _cwd = createTemporaryWorkingDirectory(directory.path);

  expect(readCommandLine(['codiff', 'definitely-missing-branch'])).toEqual({
    launchOptions: {
      repositoryPathProvided: false,
      source: {
        ref: 'definitely-missing-branch',
        type: 'branch-working-tree',
      },
    },
    pullRequestNumber: null,
    repositoryPath: null,
  });

  expect(readCommandLine(['codiff', 'definitely-missing-branch', directory.path])).toEqual({
    launchOptions: {
      repositoryPathProvided: true,
      source: {
        ref: 'definitely-missing-branch',
        type: 'branch-working-tree',
      },
    },
    pullRequestNumber: null,
    repositoryPath: directory.path,
  });
});

test('parses hex-like refs as commits before branches', async () => {
  await using directory = await createTemporaryDirectory('codiff-hex-ref-');
  await git(directory.path, ['init']);
  await git(directory.path, ['commit', '--allow-empty', '-m', 'initial commit']);
  const { stdout } = await execFileAsync('git', ['-C', directory.path, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  const shortHash = stdout.trim().slice(0, 8);
  await git(directory.path, ['branch', shortHash]);
  await using _cwd = createTemporaryWorkingDirectory(directory.path);

  expect(readCommandLine(['codiff', shortHash]).launchOptions.source).toEqual({
    ref: shortHash,
    type: 'commit',
  });

  expect(readCommandLine(['codiff', '--branch', shortHash]).launchOptions.source).toEqual({
    ref: shortHash,
    type: 'branch-working-tree',
  });
});

test('parses full GitHub pull request URLs as launch sources', () => {
  expect(
    readCommandLine(['codiff', 'https://github.com/nkzw-tech/codiff/pull/11', '/repo'])
      .launchOptions.source,
  ).toEqual({
    provider: 'github',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/11',
  });
});

test('canonicalizes GitHub pull request URLs copied from a review tab', () => {
  for (const value of [
    'https://github.com/nkzw-tech/codiff/pull/11/changes#r4821',
    'https://github.com/nkzw-tech/codiff/pull/11/files',
    'https://www.github.com/nkzw-tech/codiff/pull/11?diff=split',
    'github.com/nkzw-tech/codiff/pull/11/commits',
  ]) {
    expect(readCommandLine(['codiff', value, '/repo']).launchOptions.source).toEqual({
      provider: 'github',
      type: 'pull-request',
      url: 'https://github.com/nkzw-tech/codiff/pull/11',
    });
  }
});

test('canonicalizes GitLab merge request URLs copied from a review tab', () => {
  for (const value of [
    'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/diffs#note_991',
    'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/commits',
    'https://gitlab.example.com/group/subgroup/project/merge_requests/23',
  ]) {
    expect(readCommandLine(['codiff', value, '/repo']).launchOptions.source).toEqual({
      provider: 'gitlab',
      type: 'pull-request',
      url: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
    });
  }
});

test('resolves GitHub and GitLab review markers through repository remotes', async () => {
  await using directory = await createTemporaryDirectory('codiff-review-markers-');
  const githubRepo = join(directory.path, 'github');
  const gitlabRepo = join(directory.path, 'gitlab');

  await Promise.all([mkdir(githubRepo), mkdir(gitlabRepo)]);
  await git(githubRepo, ['init']);
  await git(githubRepo, ['remote', 'add', 'origin', 'git@github.com:nkzw-tech/codiff.git']);
  await git(gitlabRepo, ['init']);
  await git(gitlabRepo, [
    'remote',
    'add',
    'origin',
    'ssh://git@gitlab.example.com/group/subgroup/project.git',
  ]);

  expect(getCommandLineLaunchOptions(['codiff', 'pr', '12', githubRepo]).source).toEqual({
    provider: 'github',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  });
  expect(getCommandLineLaunchOptions(['codiff', 'pr', '#12', githubRepo]).source).toEqual({
    provider: 'github',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  });
  expect(getCommandLineLaunchOptions(['codiff', 'mr', '23', gitlabRepo]).source).toEqual({
    provider: 'gitlab',
    type: 'pull-request',
    url: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
  });
});

test('parses GitLab merge request markers and nested URLs', () => {
  expect(
    readCommandLine([
      'codiff',
      'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
      '/repo',
    ]).launchOptions.source,
  ).toEqual({
    provider: 'gitlab',
    type: 'pull-request',
    url: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
  });
});

test('restores the last repository for plain app launches', async () => {
  await using directory = await createTemporaryDirectory('codiff-last-repo-');

  expect(getInitialRepositoryPath('/fallback', defaultLaunchOptions, directory.path, {})).toBe(
    directory.path,
  );
});

test('does not restore missing last repositories', () => {
  expect(
    getInitialRepositoryPath('/fallback', defaultLaunchOptions, '/missing/codiff-repo', {}),
  ).toBe('/fallback');
});

test('does not restore over explicit launch intent', async () => {
  await using directory = await createTemporaryDirectory('codiff-last-repo-');

  expect(
    getInitialRepositoryPath(
      '/fallback',
      {
        repositoryPathProvided: true,
      },
      directory.path,
      {},
    ),
  ).toBe('/fallback');
  expect(
    getInitialRepositoryPath(
      '/fallback',
      {
        repositoryPathProvided: false,
        source: {
          ref: 'HEAD',
          type: 'commit',
        },
      },
      directory.path,
      {},
    ),
  ).toBe('/fallback');

  expect(
    getInitialRepositoryPath(
      '/fallback',
      {
        planFile: '/tmp/plan.md',
        repositoryPathProvided: false,
      },
      directory.path,
      {},
    ),
  ).toBe('/fallback');
  expect(
    getInitialRepositoryPath('/fallback', defaultLaunchOptions, directory.path, {
      CODIFF_REPOSITORY_PATH: '/explicit',
    }),
  ).toBe('/fallback');
});

test('reads base...head and base..head positionals as a range source', async () => {
  await using directory = await createTemporaryDirectory('codiff-range-');

  await git(directory.path, ['init']);
  await git(directory.path, ['commit', '--allow-empty', '-m', 'first']);
  await git(directory.path, ['branch', 'base']);
  await git(directory.path, ['commit', '--allow-empty', '-m', 'second']);
  await git(directory.path, ['branch', 'head']);

  expect(readCommandLine(['codiff', 'base...head', directory.path]).launchOptions.source).toEqual({
    base: 'base',
    head: 'head',
    symmetric: true,
    type: 'range',
  });

  expect(readCommandLine(['codiff', 'base..head', directory.path]).launchOptions.source).toEqual({
    base: 'base',
    head: 'head',
    symmetric: false,
    type: 'range',
  });

  // A range whose ends don't resolve is not treated as a source.
  expect(
    readCommandLine(['codiff', 'nope...nada', directory.path]).launchOptions.source,
  ).toBeUndefined();
});
