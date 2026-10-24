// @ts-check

const {} = require('node:crypto');
const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { findExecutableOnPath, isExecutableFile } = require('../command-utils.cjs');
const { getCommandEnvironment } = require('../login-shell-environment.cjs');
const {
  getFingerprint,
  git,
  gitOrEmpty,
  readGitImageFile,
  validateRepositoryPath,
} = require('./common.cjs');
const { readGitFiles } = require('./git-files.cjs');
const {
  createPatchFromPullRequestFile,
  createPullRequestSection,
  normalizeGitHubCommit,
} = require('./pull-request.cjs');
const { parseReviewUrl, readReviewRemotes } = require('../review-source.cjs');

/**
 * @typedef {import('../../core/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../../core/types.ts').PullRequestReviewComment} PullRequestReviewComment
 * @typedef {import('../../core/types.ts').ReviewSource} ReviewSource
 */

const GLAB_NOT_FOUND_CODE = 'GLAB_NOT_FOUND';
const GLAB_NOT_FOUND_MESSAGE =
  'GitLab support requires glab. Install glab, authenticate it, and verify `glab --version` works in Terminal. Codiff searches PATH, ~/.local/bin/glab, /opt/homebrew/bin/glab, and /usr/local/bin/glab. If glab is installed somewhere else, launch Codiff with `CODIFF_GLAB_PATH=/absolute/path/to/glab codiff -w`.';

/** @param {string} [detail] */
const createGlabNotFoundError = (detail) =>
  Object.assign(
    new Error(detail ? `${GLAB_NOT_FOUND_MESSAGE} ${detail}` : GLAB_NOT_FOUND_MESSAGE),
    {
      code: GLAB_NOT_FOUND_CODE,
    },
  );

const getGlabCommand = () => {
  const glabPath = process.env.CODIFF_GLAB_PATH?.trim();
  if (glabPath) {
    if (isExecutableFile(glabPath)) {
      return glabPath;
    }

    throw createGlabNotFoundError(
      `CODIFF_GLAB_PATH is set to ${JSON.stringify(glabPath)}, but that file is not executable.`,
    );
  }

  const pathCommand = findExecutableOnPath('glab');
  if (pathCommand) {
    return pathCommand;
  }

  for (const path of [
    join(homedir(), '.local/bin/glab'),
    '/opt/homebrew/bin/glab',
    '/usr/local/bin/glab',
  ]) {
    if (isExecutableFile(path)) {
      return path;
    }
  }

  throw createGlabNotFoundError();
};

/** @param {string} value */
const parseGitLabMergeRequestUrl = (value) => {
  const parsed = parseReviewUrl(value);
  if (!parsed || parsed.provider !== 'gitlab') {
    throw new Error('Codiff expected a GitLab merge request URL.');
  }
  return parsed;
};

/** @param {string} projectPath */
const encodeProjectPath = (projectPath) => encodeURIComponent(projectPath);

/**
 * @param {{host: string}} mergeRequest
 * @param {ReadonlyArray<string>} args
 * @param {unknown} [input]
 */
const createGlabApiArgs = (mergeRequest, args, input) => [
  'api',
  '--hostname',
  mergeRequest.host,
  ...(input == null ? [] : ['--header', 'Content-Type: application/json']),
  ...args,
];

/**
 * @param {string} repoRoot
 * @param {{host: string}} mergeRequest
 * @param {ReadonlyArray<string>} args
 * @param {unknown} [input]
 */
const glabApi = async (repoRoot, mergeRequest, args, input) => {
  const environment = await getCommandEnvironment();
  return new Promise((resolve, reject) => {
    let command;
    try {
      command = getGlabCommand();
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(command, createGlabApiArgs(mergeRequest, args, input), {
      cwd: repoRoot,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      reject(error.code === 'ENOENT' ? createGlabNotFoundError() : error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(
          new Error(
            Buffer.concat(stderr).toString('utf8').trim() || `glab api exited with code ${code}.`,
          ),
        );
      }
    });
    child.stdin.end(input == null ? undefined : JSON.stringify(input));
  });
};

/** @param {string} value */
const parseGlabJsonPages = (value) => {
  const documents = [];
  let depth = 0;
  let escape = false;
  let inString = false;
  let start = -1;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start === -1) {
      if (/\s/.test(character)) {
        continue;
      }
      if (character !== '[' && character !== '{') {
        throw new SyntaxError(`Unexpected character in glab JSON output at position ${index}.`);
      }
      start = index;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (character === '\\') {
        escape = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '[' || character === '{') {
      depth += 1;
    } else if (character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        documents.push(JSON.parse(value.slice(start, index + 1)));
        start = -1;
      }
    }
  }

  if (start !== -1 || inString) {
    throw new SyntaxError('Incomplete JSON document in glab output.');
  }

  return documents.flatMap((document) => (Array.isArray(document) ? document : [document]));
};

/** @param {{number: number; projectPath: string}} mergeRequest */
const mergeRequestEndpoint = (mergeRequest, suffix = '') =>
  `projects/${encodeProjectPath(mergeRequest.projectPath)}/merge_requests/${
    mergeRequest.number
  }${suffix}`;

/** @param {string} repoRoot @param {ReturnType<typeof parseGitLabMergeRequestUrl>} mergeRequest */
const selectMergeRequestRemote = (repoRoot, mergeRequest) => {
  const remote = readReviewRemotes(repoRoot)
    .filter(
      (candidate) =>
        candidate.host === mergeRequest.host &&
        candidate.projectPath.toLowerCase() === mergeRequest.projectPath.toLowerCase(),
    )
    .sort((left, right) =>
      left.name === right.name
        ? left.direction === 'fetch'
          ? -1
          : 1
        : left.name === 'origin'
          ? -1
          : 1,
    )[0];
  if (!remote) {
    throw new Error(
      `Merge request ${mergeRequest.projectPath}!${mergeRequest.number} does not match a GitLab remote in this repository.`,
    );
  }
  return remote;
};

/** @param {string} repoRoot @param {ReturnType<typeof parseGitLabMergeRequestUrl>} mergeRequest */
const readMergeRequestMetadata = async (repoRoot, mergeRequest) =>
  JSON.parse(await glabApi(repoRoot, mergeRequest, [mergeRequestEndpoint(mergeRequest)]));

/** @param {string} repoRoot @param {ReturnType<typeof parseGitLabMergeRequestUrl>} mergeRequest */
const readMergeRequestDiffs = async (repoRoot, mergeRequest) =>
  parseGlabJsonPages(
    await glabApi(repoRoot, mergeRequest, [
      '--paginate',
      `${mergeRequestEndpoint(mergeRequest, '/diffs')}?per_page=100`,
    ]),
  );

/** @param {any} diff */
const normalizeGitLabDiffFile = (diff) => ({
  filename: diff.new_path,
  patch: diff.diff,
  ...(diff.old_path !== diff.new_path ? { previous_filename: diff.old_path } : {}),
  status: diff.new_file
    ? 'added'
    : diff.deleted_file
      ? 'removed'
      : diff.renamed_file
        ? 'renamed'
        : 'modified',
});

/** @param {any} note @param {string} url */
const normalizeGitLabReviewComment = (note, url) => {
  const position = note.position || note.original_position;
  const isFilePosition = position?.position_type === 'file';
  const lineNumber = position?.new_line ?? position?.old_line;
  const filePath = position?.new_path || position?.old_path;
  if (!note.body || !filePath || (!isFilePosition && typeof lineNumber !== 'number')) {
    return null;
  }
  const side = position?.new_line != null ? 'additions' : 'deletions';
  const range = position.line_range;
  const start = range?.start;
  const end = range?.end;
  return {
    author: {
      avatarUrl: note.author?.avatar_url,
      login: note.author?.username || note.author?.name || 'GitLab user',
      url: note.author?.web_url,
    },
    body: note.body,
    filePath,
    id: `gitlab:${note.id}`,
    ...(!note.position ? { isOutdated: true } : {}),
    ...(isFilePosition
      ? { anchor: 'file' }
      : {
          lineNumber: end?.new_line ?? end?.old_line ?? lineNumber,
          side: end?.type === 'old' ? 'deletions' : side,
        }),
    ...(start && (start.new_line ?? start.old_line) !== (end?.new_line ?? end?.old_line)
      ? {
          startLineNumber: start.new_line ?? start.old_line,
          startSide: start.type === 'old' ? 'deletions' : 'additions',
        }
      : {}),
    submittedAt: note.created_at,
    url: `${url}#note_${note.id}`,
  };
};

/** @param {string} repoRoot @param {ReturnType<typeof parseGitLabMergeRequestUrl>} mergeRequest */
const readMergeRequestComments = async (repoRoot, mergeRequest) => {
  const discussions = parseGlabJsonPages(
    await glabApi(repoRoot, mergeRequest, [
      '--paginate',
      `${mergeRequestEndpoint(mergeRequest, '/discussions')}?per_page=100`,
    ]),
  );
  return discussions
    .flatMap((discussion) => discussion.notes || [])
    .filter((note) => !note.system && !note.resolved)
    .map((note) => normalizeGitLabReviewComment(note, mergeRequest.url))
    .filter(Boolean);
};

/** @param {ReturnType<typeof parseGitLabMergeRequestUrl>} mergeRequest @param {any} metadata @returns {Extract<ReviewSource, {type: 'pull-request'}>} */
const createMergeRequestSource = (mergeRequest, metadata) => ({
  ...(metadata.author?.username || metadata.author?.name
    ? {
        author: {
          avatarUrl: metadata.author.avatar_url,
          login: metadata.author.username || metadata.author.name,
          url: metadata.author.web_url,
        },
      }
    : {}),
  ...(typeof metadata.description === 'string' && metadata.description.trim()
    ? { description: metadata.description.trim() }
    : {}),
  headSha: metadata.sha,
  host: mergeRequest.host,
  number: mergeRequest.number,
  projectPath: mergeRequest.projectPath,
  provider: 'gitlab',
  title: metadata.title,
  type: 'pull-request',
  url: metadata.web_url || mergeRequest.url,
});

/** @param {string} repoRoot @param {any} mergeRequest @param {any} metadata */
const resolveMergeRequestContentRefs = async (repoRoot, _mergeRequest, metadata) => {
  const head = metadata.diff_refs?.head_sha ?? metadata.sha;
  const base = metadata.diff_refs?.base_sha;
  if (!head || !base) return null;
  const headExists = (await gitOrEmpty(repoRoot, ['cat-file', '-t', head])).trim() === 'commit';
  const baseExists = (await gitOrEmpty(repoRoot, ['cat-file', '-t', base])).trim() === 'commit';
  return headExists && baseExists ? { base, head } : null;
};

/** @param {string} launchPath @param {Extract<ReviewSource, {type: 'pull-request'}>} source */
const readMergeRequestState = async (launchPath, source) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const mergeRequest = parseGitLabMergeRequestUrl(source.url);
  selectMergeRequestRemote(repoRoot, mergeRequest);
  const [metadata, diffs, reviewComments] = await Promise.all([
    readMergeRequestMetadata(repoRoot, mergeRequest),
    readMergeRequestDiffs(repoRoot, mergeRequest),
    readMergeRequestComments(repoRoot, mergeRequest),
  ]);
  const refs = await resolveMergeRequestContentRefs(repoRoot, mergeRequest, metadata).catch(
    () => null,
  );
  const reviewFiles = diffs.map((rawDiff) => {
    const file = normalizeGitLabDiffFile(rawDiff);
    return {
      file,
      oldPath: file.previous_filename || file.filename,
      patch: createPatchFromPullRequestFile(file),
    };
  });
  const [oldFiles, newFiles] = refs
    ? await Promise.all([
        readGitFiles(
          repoRoot,
          refs.base,
          reviewFiles.map(({ oldPath }) => oldPath),
          { refScopedEmptyCacheKey: true },
        ),
        readGitFiles(
          repoRoot,
          refs.head,
          reviewFiles.map(({ file }) => file.filename),
          { refScopedEmptyCacheKey: true },
        ),
      ])
    : [new Map(), new Map()];
  /** @type {Array<ChangedFile>} */
  const files = reviewFiles.map(({ file, oldPath, patch }) => {
    const oldFile = refs ? oldFiles.get(oldPath) : null;
    const newFile = refs ? newFiles.get(file.filename) : null;
    const section = createPullRequestSection(mergeRequest, file, patch, oldFile, newFile);
    return {
      fingerprint: getFingerprint(
        [metadata.sha || '', file.status, file.previous_filename || '', file.filename, patch].join(
          '\n',
        ),
      ),
      oldPath: file.previous_filename,
      path: file.filename,
      sections: [section],
      status:
        file.status === 'added'
          ? 'added'
          : file.status === 'removed'
            ? 'deleted'
            : file.status === 'renamed'
              ? 'renamed'
              : 'modified',
    };
  });
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    generatedAt: Date.now(),
    launchPath,
    reviewComments,
    root: repoRoot,
    source: createMergeRequestSource(mergeRequest, metadata),
  };
};

/** @param {any} commit @param {'base' | 'pull-request'} scope */
const normalizeGitLabCommit = (commit, scope) =>
  normalizeGitHubCommit(
    {
      commit: {
        author: {
          date: commit.committed_date || commit.authored_date,
          name: commit.author_name,
        },
        message: commit.message || commit.title,
      },
      parents: (commit.parent_ids || []).map((sha) => ({ sha })),
      sha: commit.id,
    },
    scope,
  );

/** @param {string} repoRoot @param {any} mergeRequest @param {string} ref @param {number} limit */
const readRepositoryCommits = async (repoRoot, mergeRequest, ref, limit) => {
  const commits = [];
  for (let page = 1; commits.length < limit; page += 1) {
    const perPage = Math.min(limit - commits.length, 100);
    const pageCommits = JSON.parse(
      await glabApi(repoRoot, mergeRequest, [
        `projects/${encodeProjectPath(mergeRequest.projectPath)}/repository/commits?ref_name=${encodeURIComponent(
          ref,
        )}&per_page=${perPage}&page=${page}`,
      ]),
    );
    if (!Array.isArray(pageCommits) || pageCommits.length === 0) {
      break;
    }
    commits.push(...pageCommits);
    if (pageCommits.length < perPage) {
      break;
    }
  }
  return commits;
};

/** @param {string} launchPath @param {Extract<ReviewSource, {type: 'pull-request'}>} source @param {number} [limit] */
const listMergeRequestHistory = async (launchPath, source, limit = 200) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const mergeRequest = parseGitLabMergeRequestUrl(source.url);
  const metadata = await readMergeRequestMetadata(repoRoot, mergeRequest);
  const commits = parseGlabJsonPages(
    await glabApi(repoRoot, mergeRequest, [
      '--paginate',
      `${mergeRequestEndpoint(mergeRequest, '/commits')}?per_page=100`,
    ]),
  );
  const baseCommits = metadata.target_branch
    ? await readRepositoryCommits(repoRoot, mergeRequest, metadata.target_branch, limit)
    : [];
  return {
    entries: [
      ...commits
        .map((commit) => normalizeGitLabCommit(commit, 'pull-request'))
        .filter(Boolean)
        .reverse(),
      ...baseCommits.map((commit) => normalizeGitLabCommit(commit, 'base')).filter(Boolean),
    ],
    root: repoRoot,
  };
};

/** @param {string} launchPath @param {Extract<ReviewSource, {type: 'pull-request'}>} source @param {string} requestedPath */
const readMergeRequestImageContent = async (launchPath, source, requestedPath) => {
  try {
    const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
    const path = validateRepositoryPath(requestedPath);
    const mergeRequest = parseGitLabMergeRequestUrl(source.url);
    const metadata = await readMergeRequestMetadata(repoRoot, mergeRequest);
    const diffs = await readMergeRequestDiffs(repoRoot, mergeRequest);
    const rawDiff = diffs.find((candidate) => candidate.new_path === path);
    if (!rawDiff) {
      throw new Error('File is not part of this merge request.');
    }
    const refs = await resolveMergeRequestContentRefs(repoRoot, mergeRequest, metadata);
    const [oldImage, newImage] = await Promise.all([
      refs ? readGitImageFile(repoRoot, refs.base, rawDiff.old_path) : undefined,
      refs ? readGitImageFile(repoRoot, refs.head, rawDiff.new_path) : undefined,
    ]);
    return oldImage || newImage
      ? { ...(newImage ? { newImage } : {}), ...(oldImage ? { oldImage } : {}), status: 'ready' }
      : { reason: 'Codiff could not load either side of this image.', status: 'unavailable' };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : 'Codiff could not load this image.',
      status: 'unavailable',
    };
  }
};

module.exports = {
  listMergeRequestHistory,
  normalizeGitLabReviewComment,
  parseGitLabMergeRequestUrl,
  readMergeRequestImageContent,
  readMergeRequestState,
};
