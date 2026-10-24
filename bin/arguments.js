import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import reviewSource from '../electron/review-source.cjs';

const { parseReviewUrl, resolveReviewUrl } = reviewSource;

/** @type {Array<{argument?: string; consumesSource?: boolean; description: string; hidden?: boolean; name: string; short?: string; type: string}>} */
export const flagDefinitions = [
  {
    argument: '<ref>',
    // With the source given as a flag, the positional argument can only be the
    // repository path.
    consumesSource: true,
    description: 'Review the current branch against a target branch.',
    name: 'branch',
    type: 'string',
  },

  {
    argument: '<ref>',
    consumesSource: true,
    description: 'Review a specific commit.',
    name: 'commit',
    type: 'string',
  },

  {
    argument: '<bash|fish|zsh>',
    description: 'Print a shell completion script, then exit.',
    name: 'completions',
    type: 'string',
  },
  { description: 'Show this help message and exit.', name: 'help', short: 'h', type: 'boolean' },

  {
    description: 'Show version number and exit.',
    name: 'version',
    short: 'v',
    type: 'boolean',
  },
];

const usageExamples = [
  { command: 'codiff', description: 'Review staged and unstaged changes.' },
  { command: 'codiff /path/to/repo', description: 'Review changes in a specific repository.' },
  { command: 'codiff main', description: 'Review the current branch against main.' },
  { command: 'codiff a1b2c3d', description: 'Review a specific commit.' },
  { command: "codiff '#75'", description: 'Review pull request #75.' },
  { command: 'codiff pr 75', description: 'Review pull request #75 (alternate syntax).' },
  {
    command: 'codiff pr owner:feature',
    description: 'Review the open pull request for a branch.',
  },
  { command: 'codiff mr 75', description: 'Review GitLab merge request !75.' },
];

export const getReviewSource = ({
  branchRef,
  commitRef,
  pullRequestProvider,
  pullRequestUrl,
  range,
}) =>
  range
    ? {
        base: range.base,
        head: range.head,
        symmetric: range.symmetric,
        type: 'range',
      }
    : pullRequestUrl
      ? {
          ...(pullRequestProvider ? { provider: pullRequestProvider } : {}),
          type: 'pull-request',
          url: pullRequestUrl,
        }
      : commitRef
        ? { ref: commitRef, type: 'commit' }
        : branchRef
          ? { ref: branchRef, type: 'branch-working-tree' }
          : undefined;

const parseArgsOptions = Object.fromEntries(
  flagDefinitions.map(({ name, short, type }) => [name, { type, ...(short ? { short } : {}) }]),
);

const ansi = {
  blueBold: '\u001b[1;34m',
  gray: '\u001b[90m',
  reset: '\u001b[0m',
};

const blueBold = (text) => `${ansi.blueBold}${text}${ansi.reset}`;
const gray = (text) => `${ansi.gray}${text}${ansi.reset}`;

export const formatHelpText = (version) => {
  const flagLines = flagDefinitions
    .filter(({ hidden }) => !hidden)
    .map(({ argument, description, name, short }) => {
      const label = `--${name}${argument ? ` ${argument}` : ''}${short ? `, -${short}` : ''}`;
      return { description, label };
    });
  const flagPad = Math.max(...flagLines.map(({ label }) => label.length)) + 2;

  const examplePad = Math.max(...usageExamples.map(({ command }) => command.length)) + 2;

  const lines = [
    `${blueBold(`codiff v${version}`)} ${gray('A fast local diff viewer.')}`,
    '',
    `${blueBold('Usage:')} ${gray('codiff [options] [<ref> | <pr> | <url>] [path]')}`,
    '',
    blueBold('Options:'),
    ...flagLines.map(
      ({ description, label }) =>
        `  ${label}${' '.repeat(flagPad - label.length)}${gray(description)}`,
    ),
    '',
    blueBold('Examples:'),
    ...usageExamples.map(
      ({ command, description }) =>
        `  ${command}${' '.repeat(examplePad - command.length)}${gray(description)}`,
    ),
    '',
  ];

  return lines.join('\n');
};

const commitHashPattern = /^[0-9a-f]{4,64}$/i;
const headCommitRefPattern = /^(?:HEAD|@)(?:(?:[~^]\d*)|\^\{[^}]+\}|@\{[^}]+\})*$/;
const pullRequestNumberPattern = /^#([1-9]\d*)$/;
const revisionSyntaxPattern = /(?:\^|~|@\{[^}]+\})/;

const isCommitRefArgument = (arg) =>
  !existsSync(resolve(arg)) &&
  (commitHashPattern.test(arg) ||
    headCommitRefPattern.test(arg) ||
    revisionSyntaxPattern.test(arg));

const isExplicitPathArgument = (arg) =>
  arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../');

// `base...head` (symmetric / merge-base) or `base..head` (direct) range syntax.
const rangeArgumentPattern = /^([^.][^\s]*?)(\.\.\.?)([^.][^\s]*)$/;
const parseRangeArgument = (arg) => {
  if (isExplicitPathArgument(arg)) {
    return null;
  }
  const match = arg.match(rangeArgumentPattern);
  if (!match) {
    return null;
  }
  return { base: match[1], head: match[3], symmetric: match[2] === '...' };
};

const gitSucceeds = (repositoryPath, args) => {
  try {
    execFileSync('git', ['-C', repositoryPath, ...args], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
};

const isGitRepository = (repositoryPath) =>
  gitSucceeds(repositoryPath, ['rev-parse', '--show-toplevel']);

const isBranchRef = (repositoryPath, ref) =>
  gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/heads/${ref}`]) ||
  gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`]);

const isCommitRef = (repositoryPath, ref) =>
  gitSucceeds(repositoryPath, ['rev-parse', '--verify', `${ref}^{commit}`]);

const resolveSourceCandidate = (repositoryPath, ref) =>
  isCommitRefArgument(ref) && isCommitRef(repositoryPath, ref)
    ? { commitRef: ref }
    : isBranchRef(repositoryPath, ref)
      ? { branchRef: ref }
      : isCommitRef(repositoryPath, ref) || isCommitRefArgument(ref)
        ? { commitRef: ref }
        : null;

const parsePullRequestNumberArgument = (arg) => {
  const match = arg.match(pullRequestNumberPattern);
  return match ? Number(match[1]) : null;
};

const parsePullRequestNumberValue = (arg) =>
  parsePullRequestNumberArgument(arg.startsWith('#') ? arg : `#${arg}`);

const getReviewProviderMarker = (arg) =>
  /^(?:pr|pull-request)$/i.test(arg)
    ? 'github'
    : /^(?:mr|merge-request)$/i.test(arg)
      ? 'gitlab'
      : null;

// Store the canonical form so pasted review tabs, queries and anchors never reach the Git layer.
const parsePullRequestUrlArgument = (arg) => parseReviewUrl(arg)?.url ?? null;

export const resolvePullRequestUrl = (repositoryPath, number, provider) =>
  resolveReviewUrl(repositoryPath, number, provider);

export const resolvePullRequestTargetUrl = ({ branch, number, provider, repositoryPath, url }) => {
  if (url) {
    return url;
  }
  if (branch) {
    if (provider !== 'github') {
      throw new Error('Pull request branch lookup is only supported for GitHub.');
    }

    const notFoundMessage = `Could not find an open GitHub pull request for branch "${branch}".`;
    let output;
    try {
      output = execFileSync('gh', ['pr', 'view', branch, '--json', 'state,url'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      throw new Error(notFoundMessage);
    }

    try {
      const pullRequest = JSON.parse(output);
      const parsedUrl =
        pullRequest?.state === 'OPEN' && typeof pullRequest.url === 'string'
          ? parseReviewUrl(pullRequest.url)
          : null;
      if (parsedUrl?.provider === 'github') {
        return parsedUrl.url;
      }
    } catch {
      // Report invalid or unexpected `gh` output as a failed lookup.
    }
    throw new Error(notFoundMessage);
  }
  return number != null ? resolvePullRequestUrl(repositoryPath, number, provider) : null;
};

export const parseArguments = (args) => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: parseArgsOptions,
    strict: false,
  });

  for (const name of Object.keys(values)) {
    if (!Object.hasOwn(parseArgsOptions, name)) {
      throw new Error(`Unknown option: --${name}`);
    }
  }

  let commitRef = typeof values.commit === 'string' ? values.commit : null;
  let branchRef = typeof values.branch === 'string' ? values.branch : null;

  // `--completions` without a value parses as `true`; keep it as an empty shell
  // so the command can tell "no shell given" apart from "flag not used".
  const completionShell =
    typeof values.completions === 'string'
      ? values.completions
      : values.completions === true
        ? ''
        : null;

  let pullRequestBranch = null;
  let pullRequestNumber = null;
  let pullRequestProvider = null;
  let pullRequestUrl = null;
  let requestedPath = null;
  let sourceCandidate = null;
  let rangeCandidate = null;

  for (let index = 0; index < positionals.length; index += 1) {
    const arg = positionals[index];

    const parsedPullRequestUrl = pullRequestUrl ? null : parsePullRequestUrlArgument(arg);
    if (parsedPullRequestUrl) {
      pullRequestUrl = parsedPullRequestUrl;
      continue;
    }

    if (!pullRequestUrl && pullRequestNumber == null) {
      const number = parsePullRequestNumberArgument(arg);
      if (number != null) {
        pullRequestNumber = number;
        continue;
      }

      const markerProvider = getReviewProviderMarker(arg);
      const nextValue = markerProvider ? positionals[index + 1] : null;
      const nextNumber = nextValue ? parsePullRequestNumberValue(nextValue) : null;
      if (nextNumber != null) {
        pullRequestNumber = nextNumber;
        pullRequestProvider = markerProvider;
        index += 1;
        continue;
      }
      const parsedNextValue =
        markerProvider && nextValue ? parsePullRequestUrlArgument(nextValue) : null;
      if (parsedNextValue) {
        pullRequestProvider = markerProvider;
        pullRequestUrl = parsedNextValue;
        index += 1;
        continue;
      }
      if (markerProvider === 'github' && nextValue) {
        pullRequestBranch = nextValue;
        pullRequestProvider = markerProvider;
        index += 1;
        continue;
      }
    }

    if (!rangeCandidate && !commitRef && !branchRef && !sourceCandidate) {
      const range = parseRangeArgument(arg);
      if (range) {
        rangeCandidate = range;
        continue;
      }
    }

    if (!commitRef && !branchRef && !sourceCandidate && !isExplicitPathArgument(arg)) {
      sourceCandidate = arg;
    } else if (requestedPath == null) {
      requestedPath = arg;
    }
  }

  const repositoryPath = resolve(requestedPath ?? process.cwd());
  let range = null;
  if (rangeCandidate) {
    // Only honor the range when both ends resolve in this repository; otherwise
    // fall back so a stray `a..b`-shaped argument isn't silently misread.
    range =
      isCommitRef(repositoryPath, rangeCandidate.base) &&
      isCommitRef(repositoryPath, rangeCandidate.head)
        ? rangeCandidate
        : null;
  }
  if (!range && !commitRef && !branchRef && sourceCandidate) {
    const source = resolveSourceCandidate(repositoryPath, sourceCandidate);
    if (source?.branchRef) {
      branchRef = source.branchRef;
    } else if (source?.commitRef) {
      commitRef = source.commitRef;
    } else if (requestedPath == null && existsSync(resolve(sourceCandidate))) {
      requestedPath = sourceCandidate;
    } else if (isGitRepository(repositoryPath)) {
      branchRef = sourceCandidate;
    } else if (requestedPath == null) {
      requestedPath = sourceCandidate;
    }
  }

  return {
    ...{},
    ...(branchRef ? { branchRef } : {}),
    ...(range ? { range } : {}),
    commitRef,
    ...(completionShell === null ? {} : { completionShell }),
    help: values.help === true,
    ...(pullRequestBranch ? { pullRequestBranch } : {}),
    pullRequestNumber,
    ...(pullRequestProvider ? { pullRequestProvider } : {}),
    pullRequestUrl,

    requestedPath: resolve(requestedPath ?? process.cwd()),

    version: values.version === true,
  };
};
