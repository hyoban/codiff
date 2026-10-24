import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import {
  formatHelpText,
  parseArguments,
  resolvePullRequestTargetUrl,
  resolvePullRequestUrl,
} from '../../bin/arguments.js';
import { createFakeOpenLogger } from './helpers/cli.ts';
import { removeGitTestDirectory } from './helpers/git.ts';
import { getGitTestEnvironment } from './helpers/git.ts';
import {
  createTemporaryDirectory,
  createTemporaryEnvironment,
  createTemporaryWorkingDirectory,
} from './helpers/resources.ts';

const execFileAsync = promisify(execFile);

const git = async (repo: string, args: ReadonlyArray<string>) => {
  await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: getGitTestEnvironment(),
  });
};

let refRepositoryPath = '';
let refRepositoryShortHash = '';

beforeAll(async () => {
  refRepositoryPath = await realpath(await mkdtemp(join(tmpdir(), 'codiff-cli-refs-')));
  await git(refRepositoryPath, ['init']);
  await git(refRepositoryPath, ['commit', '--allow-empty', '-m', 'first']);
  await git(refRepositoryPath, ['branch', 'base']);
  await git(refRepositoryPath, ['commit', '--allow-empty', '-m', 'second']);
  await git(refRepositoryPath, ['branch', 'feature']);
  await git(refRepositoryPath, ['branch', 'feature.v1']);
  const { stdout } = await execFileAsync('git', ['-C', refRepositoryPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  refRepositoryShortHash = stdout.trim().slice(0, 8);
  await git(refRepositoryPath, ['branch', refRepositoryShortHash]);
  await git(refRepositoryPath, ['branch', 'target']);
});

afterAll(async () => {
  if (refRepositoryPath) {
    await removeGitTestDirectory(refRepositoryPath);
  }
});

const withCwd = async <T>(cwd: string, callback: () => T | Promise<T>) => {
  using _workingDirectory = createTemporaryWorkingDirectory(cwd);
  return await callback();
};

const withFakeGitHubCli = async <T>(
  response: Record<string, unknown>,
  callback: (argsPath: string) => T | Promise<T>,
) => {
  await using directory = await createTemporaryDirectory('codiff-cli-gh-');
  const argsPath = join(directory.path, 'args.txt');
  const commandPath = join(directory.path, 'gh');

  await writeFile(
    commandPath,
    '#!/bin/sh\nfor arg in "$@"; do\n  printf "%s\\n" "$arg" >> "$CODIFF_TEST_GH_ARGS"\ndone\nprintf "%s\\n" "$CODIFF_TEST_GH_RESPONSE"\n',
  );
  await chmod(commandPath, 0o755);
  await using _environment = createTemporaryEnvironment({
    CODIFF_TEST_GH_ARGS: argsPath,
    CODIFF_TEST_GH_RESPONSE: JSON.stringify(response),
    PATH: `${directory.path}:${process.env.PATH ?? ''}`,
  });
  return await callback(argsPath);
};

test('parseArguments treats a hash positional as a commit ref', () => {
  const commitRef = 'a1b2c3d4e5f678901234567890abcdef12345678';

  expect(parseArguments([commitRef])).toEqual({
    commitRef,
    help: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments treats HEAD positional revisions as commit refs', () => {
  expect(parseArguments(['HEAD'])).toEqual({
    commitRef: 'HEAD',
    help: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });

  expect(parseArguments(['HEAD^1'])).toEqual({
    commitRef: 'HEAD^1',
    help: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments canonicalizes review URLs copied from a review tab', () => {
  for (const value of [
    'https://github.com/nkzw-tech/codiff/pull/1728/changes#r4821',
    'https://github.com/nkzw-tech/codiff/pull/1728/files',
    'https://www.github.com/nkzw-tech/codiff/pull/1728?diff=split',
    'github.com/nkzw-tech/codiff/pull/1728',
  ]) {
    expect(parseArguments([value])).toMatchObject({
      pullRequestUrl: 'https://github.com/nkzw-tech/codiff/pull/1728',
    });
  }

  for (const value of [
    'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/diffs#note_991',
    'https://gitlab.example.com/group/subgroup/project/merge_requests/23',
  ]) {
    expect(parseArguments([value])).toMatchObject({
      pullRequestUrl: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
    });
  }
});

test('parseArguments treats plain branch refs as branch refs', async () => {
  await withCwd(refRepositoryPath, () => {
    expect(parseArguments(['feature'])).toEqual({
      branchRef: 'feature',
      commitRef: null,
      help: false,
      pullRequestNumber: null,
      pullRequestUrl: null,
      requestedPath: refRepositoryPath,
      version: false,
    });
  });
});

test('parseArguments treats missing plain refs in Git repositories as branch refs', async () => {
  await withCwd(refRepositoryPath, () => {
    expect(parseArguments(['definitely-missing-branch'])).toMatchObject({
      branchRef: 'definitely-missing-branch',
      commitRef: null,
      requestedPath: refRepositoryPath,
    });

    expect(parseArguments(['definitely-missing-branch', refRepositoryPath])).toMatchObject({
      branchRef: 'definitely-missing-branch',
      commitRef: null,
      requestedPath: refRepositoryPath,
    });
  });
});

test('parseArguments treats hex-like refs as commits before branches', async () => {
  await withCwd(refRepositoryPath, () => {
    expect(parseArguments([refRepositoryShortHash])).toMatchObject({
      commitRef: refRepositoryShortHash,
      requestedPath: refRepositoryPath,
    });

    expect(parseArguments(['--branch', refRepositoryShortHash])).toMatchObject({
      branchRef: refRepositoryShortHash,
      commitRef: null,
      requestedPath: refRepositoryPath,
    });
  });
});

test('parseArguments keeps existing hash-like paths as repository paths', async () => {
  await using directory = await createTemporaryDirectory('codiff-cli-');
  const repositoryPath = join(directory.path, 'deadbeef');

  await mkdir(repositoryPath);

  expect(parseArguments([repositoryPath])).toEqual({
    commitRef: null,
    help: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    requestedPath: repositoryPath,
    version: false,
  });
});

test('parseArguments treats GitHub pull request URLs as review sources', () => {
  const pullRequestUrl = 'https://github.com/nkzw-tech/codiff/pull/3';

  expect(parseArguments([pullRequestUrl])).toEqual({
    commitRef: null,
    help: false,
    pullRequestNumber: null,
    pullRequestUrl,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments treats PR number shorthands as review sources', () => {
  expect(parseArguments(['#75'])).toEqual({
    commitRef: null,
    help: false,
    pullRequestNumber: 75,
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments treats PR marker arguments as review sources', () => {
  expect(parseArguments(['pr', '75'])).toEqual({
    commitRef: null,
    help: false,
    pullRequestNumber: 75,
    pullRequestProvider: 'github',
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments treats GitHub PR branch markers as review sources', () => {
  expect(
    parseArguments(['pr', 'iminoso:feat/pr-branch-lookup', '/path/to/repository']),
  ).toMatchObject({
    pullRequestBranch: 'iminoso:feat/pr-branch-lookup',
    pullRequestNumber: null,
    pullRequestProvider: 'github',
    requestedPath: '/path/to/repository',
  });
});

test('parseArguments treats hash-prefixed PR marker values as review sources', () => {
  expect(parseArguments(['pr', '#75'])).toEqual({
    commitRef: null,
    help: false,
    pullRequestNumber: 75,
    pullRequestProvider: 'github',
    pullRequestUrl: null,
    requestedPath: resolve(process.cwd()),
    version: false,
  });
});

test('parseArguments treats GitLab MR marker values as review sources', () => {
  expect(parseArguments(['mr', '23'])).toMatchObject({
    pullRequestNumber: 23,
    pullRequestProvider: 'gitlab',
  });
});

test('parseArguments accepts nested GitLab merge request URLs', () => {
  expect(
    parseArguments(['https://gitlab.example.com/group/subgroup/project/-/merge_requests/23']),
  ).toMatchObject({
    pullRequestUrl: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
  });
});

test('resolvePullRequestUrl builds GitHub PR URLs from the origin remote', async () => {
  await using directory = await createTemporaryDirectory('codiff-cli-');
  const repositoryPath = directory.path;

  await git(repositoryPath, ['init']);
  await git(repositoryPath, ['remote', 'add', 'upstream', 'https://github.com/other/repo.git']);
  await git(repositoryPath, ['remote', 'add', 'origin', 'git@github.com:nkzw-tech/codiff.git']);

  expect(resolvePullRequestUrl(repositoryPath, 75)).toBe(
    'https://github.com/nkzw-tech/codiff/pull/75',
  );
});

test('resolvePullRequestUrl builds GitLab MR URLs from an arbitrary GitLab remote', async () => {
  await using directory = await createTemporaryDirectory('codiff-cli-');
  const repositoryPath = directory.path;

  await git(repositoryPath, ['init']);
  await git(repositoryPath, [
    'remote',
    'add',
    'origin',
    'git@gitlab.example.com:group/subgroup/project.git',
  ]);

  expect(resolvePullRequestUrl(repositoryPath, 23, 'gitlab')).toBe(
    'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
  );
});

test(
  'PR branch lookup preserves the canonical GitHub URL returned by gh',
  { concurrent: false },
  async () => {
    await withFakeGitHubCli(
      {
        state: 'OPEN',
        url: 'https://github.com/nkzw-tech/codiff/pull/129',
      },
      async (argsPath) => {
        expect(
          resolvePullRequestTargetUrl({
            branch: 'iminoso:feat/pr-branch-lookup',
            number: null,
            provider: 'github',
            repositoryPath: process.cwd(),
            url: null,
          }),
        ).toBe('https://github.com/nkzw-tech/codiff/pull/129');
        expect(await readFile(argsPath, 'utf8')).toBe(
          ['pr', 'view', 'iminoso:feat/pr-branch-lookup', '--json', 'state,url', ''].join('\n'),
        );
      },
    );
  },
);

test('PR branch lookup rejects merged pull requests', { concurrent: false }, async () => {
  await withFakeGitHubCli(
    {
      state: 'MERGED',
      url: 'https://github.com/nkzw-tech/codiff/pull/127',
    },
    () => {
      expect(() =>
        resolvePullRequestTargetUrl({
          branch: 'owner:merged-branch',
          number: null,
          provider: 'github',
          repositoryPath: process.cwd(),
          url: null,
        }),
      ).toThrow('Could not find an open GitHub pull request for branch "owner:merged-branch".');
    },
  );
});

test('packaged terminal helper forwards --commit HEAD to Electron', async () => {
  await using logger = await createFakeOpenLogger();
  const repositoryPath = join(logger.directory, 'repo');

  await mkdir(repositoryPath);

  await execFileAsync(resolve('bin/codiff-app'), ['--commit', 'HEAD', repositoryPath], {
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    '--commit',
    'HEAD',
    repositoryPath,
  ]);
});

test('packaged terminal helper resolves GitHub PR branches to canonical URLs', async () => {
  await using logger = await createFakeOpenLogger();
  const ghArgsPath = join(logger.directory, 'gh-args.txt');
  const ghPath = join(logger.directory, 'bin', 'gh');
  const repositoryPath = join(logger.directory, 'repo');

  await mkdir(repositoryPath);
  await writeFile(
    ghPath,
    '#!/bin/sh\nfor arg in "$@"; do\n  printf "%s\\n" "$arg" >> "$GH_ARGS_FILE"\ndone\nprintf "%s\\n" "https://github.com/nkzw-tech/codiff/pull/129"\n',
  );
  await chmod(ghPath, 0o755);

  await execFileAsync(
    resolve('bin/codiff-app'),
    ['pr', 'iminoso:feat/pr-branch-lookup', repositoryPath],
    {
      env: {
        ...logger.env,
        GH_ARGS_FILE: ghArgsPath,
      },
    },
  );

  expect(await readFile(ghArgsPath, 'utf8')).toBe(
    [
      'pr',
      'view',
      'iminoso:feat/pr-branch-lookup',
      '--json',
      'state,url',
      '--jq',
      'select(.state == "OPEN") | .url',
      '',
    ].join('\n'),
  );
  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    'https://github.com/nkzw-tech/codiff/pull/129',
    repositoryPath,
  ]);
});

test('packaged terminal helper forwards GitLab MR markers to Electron', async () => {
  await using logger = await createFakeOpenLogger();

  await execFileAsync(resolve('bin/codiff-app'), ['mr', '23'], {
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    'mr',
    '23',
    process.cwd(),
  ]);
});

test('packaged terminal helper forwards review URLs copied from a review tab', async () => {
  for (const value of [
    'https://github.com/nkzw-tech/codiff/pull/1728/changes#r4821',
    'https://github.com/nkzw-tech/codiff/pull/1728/files',
    'https://www.github.com/nkzw-tech/codiff/pull/1728?diff=split',
    'github.com/nkzw-tech/codiff/pull/1728',
    'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/diffs#note_991',
    'https://gitlab.example.com/group/subgroup/project/merge_requests/23',
  ]) {
    await using logger = await createFakeOpenLogger();

    await execFileAsync(resolve('bin/codiff-app'), [value], {
      env: logger.env,
    });

    expect(await logger.readArgs()).toEqual([
      '-n',
      resolve('bin/../../../..'),
      '--args',
      value,
      process.cwd(),
    ]);
  }
});

test('packaged terminal helper forwards HEAD^1 to Electron as a commit', async () => {
  await using logger = await createFakeOpenLogger();

  await execFileAsync(resolve('bin/codiff-app'), ['HEAD^1'], {
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    '--commit',
    'HEAD^1',
    process.cwd(),
  ]);
});

test('packaged terminal helper forwards branch names to Electron as branches', async () => {
  await using logger = await createFakeOpenLogger();

  await execFileAsync(resolve('bin/codiff-app'), ['feature'], {
    cwd: refRepositoryPath,
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    '--branch',
    'feature',
    refRepositoryPath,
  ]);
});

test.each(['base...feature', 'base..feature', 'base...feature.v1', 'base..feature.v1'])(
  'packaged terminal helper forwards the %s range to Electron unclassified',
  async (range) => {
    await using logger = await createFakeOpenLogger();

    await execFileAsync(resolve('bin/codiff-app'), [range], {
      cwd: refRepositoryPath,
      env: logger.env,
    });

    expect(await logger.readArgs()).toEqual([
      '-n',
      resolve('bin/../../../..'),
      '--args',
      range,
      refRepositoryPath,
    ]);
  },
);

test.each([
  'base...missing',
  'base....feature',
  'base.....feature',
  'base...feature..base',
  'base..feature...base',
])(
  'packaged terminal helper forwards the invalid %s range to Electron as a branch',
  async (range) => {
    await using logger = await createFakeOpenLogger();

    await execFileAsync(resolve('bin/codiff-app'), [range], {
      cwd: refRepositoryPath,
      env: logger.env,
    });

    expect(await logger.readArgs()).toEqual([
      '-n',
      resolve('bin/../../../..'),
      '--args',
      '--branch',
      range,
      refRepositoryPath,
    ]);
  },
);

test('packaged terminal helper forwards missing branch names to Electron as branches', async () => {
  await using logger = await createFakeOpenLogger();

  await execFileAsync(resolve('bin/codiff-app'), ['definitely-missing-branch'], {
    cwd: refRepositoryPath,
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    '--branch',
    'definitely-missing-branch',
    refRepositoryPath,
  ]);
});

test('packaged terminal helper forwards hex refs to Electron as commits', async () => {
  await using logger = await createFakeOpenLogger();

  await execFileAsync(resolve('bin/codiff-app'), [refRepositoryShortHash], {
    cwd: refRepositoryPath,
    env: logger.env,
  });

  expect(await logger.readArgs()).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    '--commit',
    refRepositoryShortHash,
    refRepositoryPath,
  ]);
});

test('packaged terminal helper forwards relative repository paths as absolute paths', async () => {
  await using logger = await createFakeOpenLogger();
  const repositoryPath = join(logger.directory, 'repo');

  await mkdir(join(repositoryPath, 'sub'), { recursive: true });
  const actualRepositoryPath = await realpath(repositoryPath);

  const runHelper = async (args: ReadonlyArray<string>) => {
    await logger.reset();
    await execFileAsync(resolve('bin/codiff-app'), args, {
      cwd: repositoryPath,
      env: logger.env,
    });
    return logger.readArgs();
  };

  expect(await runHelper(['.'])).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    `${actualRepositoryPath}/.`,
  ]);
  expect(await runHelper(['sub'])).toEqual([
    '-n',
    resolve('bin/../../../..'),
    '--args',
    join(actualRepositoryPath, 'sub'),
  ]);
  await expect(runHelper(['-w', '.'])).rejects.toThrow('unknown option');
});

test('parseArguments recognizes --help and -h flags', () => {
  expect(parseArguments(['--help']).help).toBe(true);
  expect(parseArguments(['-h']).help).toBe(true);
});

test('parseArguments recognizes --version and -v flags', () => {
  expect(parseArguments(['--version']).version).toBe(true);
  expect(parseArguments(['-v']).version).toBe(true);
});

test('parseArguments defaults help and version to false', () => {
  const result = parseArguments([]);
  expect(result.help).toBe(false);
  expect(result.version).toBe(false);
});

test.each(['--agent', '--codex-session', '--walkthrough', '--walkthrough-file', '-w'])(
  'rejects removed option %s',
  (option) => {
    expect(() => parseArguments([option])).toThrow('Unknown option');
  },
);

test('formatHelpText includes version and all flags', () => {
  const text = formatHelpText('1.2.3');
  expect(text).toContain('codiff v1.2.3');
  expect(text).toContain('Usage:');
  expect(text).toContain('--help');
  expect(text).toContain('--version');
  expect(text).toContain('--commit');
  expect(text).not.toContain('--codex-session');
  expect(text).not.toContain('--opencode-session');
  expect(text).not.toContain('--plan');
  expect(text).not.toContain('--share');
  expect(text).not.toContain('--walkthrough');
  expect(text).not.toContain('--walkthrough-context');
  expect(text).toContain('-h');
  expect(text).toContain('-v');
  expect(text).not.toContain('-w');
  expect(text).not.toContain('codiff --plan plan.md --share');
  expect(text).toContain('codiff pr owner:feature');
});

test('formatHelpText styles titles and descriptions', () => {
  const text = formatHelpText('1.2.3');

  expect(text).toContain('\u001b[1;34mUsage:\u001b[0m');
  expect(text).toContain('\u001b[1;34mOptions:\u001b[0m');
  expect(text).toContain('\u001b[1;34mExamples:\u001b[0m');
  expect(text).toContain('  --help, -h');
  expect(text).not.toContain('\u001b[1;34m--help, -h\u001b[0m');
  expect(text).toContain('\u001b[90mShow this help message and exit.\u001b[0m');
  expect(text).toContain('  codiff main');
  expect(text).not.toContain('\u001b[1;34mcodiff main\u001b[0m');
  expect(text).toContain('\u001b[90mReview the current branch against main.\u001b[0m');
});

test('codiff-app prints help text and exits 0', async () => {
  const { stdout } = await execFileAsync(resolve('bin/codiff-app'), ['--help'], {
    encoding: 'utf8',
  });
  expect(stdout).toContain('codiff v');
  expect(stdout).toContain('Usage:');
  expect(stdout).toContain('--help');
  expect(stdout).not.toContain('--opencode-session <id>');
  expect(stdout).not.toContain('--agent <codex|claude|opencode|pi>Override');
  expect(stdout).toContain('\u001b[1;34mUsage:\u001b[0m');
  expect(stdout).toContain('\u001b[90mShow this help message and exit.\u001b[0m');
});

test('codiff-app prints version and exits 0', async () => {
  const { stdout } = await execFileAsync(resolve('bin/codiff-app'), ['--version'], {
    encoding: 'utf8',
  });
  expect(stdout).toMatch(/^codiff v\d+\.\d+\.\d+\n$/);
});

test('parseArguments reads base...target and base..target as a range', async () => {
  await withCwd(refRepositoryPath, () => {
    expect(parseArguments(['base...target'])).toMatchObject({
      range: { base: 'base', head: 'target', symmetric: true },
      requestedPath: refRepositoryPath,
    });
    expect(parseArguments(['base..target'])).toMatchObject({
      range: { base: 'base', head: 'target', symmetric: false },
    });
    // Unresolved refs fall back instead of being silently read as a range.
    expect(parseArguments(['nope...nada']).range).toBeUndefined();
  });
});
