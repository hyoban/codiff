import type { CodiffDiffStyle } from './config/types.ts';

export type DiffSection = {
  binary: boolean;
  id: string;
  kind: 'commit' | 'pull-request' | 'staged' | 'unstaged';
  loadState?: 'binary' | 'deferred' | 'directory' | 'error' | 'ready' | 'too-large';
  newFile?: {
    cacheKey?: string;
    contents: string;
    name: string;
  };
  oldFile?: {
    cacheKey?: string;
    contents: string;
    name: string;
  };
  patch: string;
  summary?: {
    canLoad?: boolean;
    fileCount?: number;
    fingerprint?: string;
    limit?: number;
    reason: string;
    size?: number;
  };
};

export type GitFileStatus =
  | 'added'
  | 'conflicted'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'untracked';

export type ChangedFile = {
  fingerprint: string;
  generated?: boolean;
  oldPath?: string;
  path: string;
  sections: ReadonlyArray<DiffSection>;
  status: GitFileStatus;
};

export type ReviewAuthor = {
  avatarUrl?: string;
  login: string;
  name?: string;
  url?: string;
};

export type PullRequestReviewer = ReviewAuthor & {
  approved: boolean;
  id: string;
};

export type PullRequestReviewActionStatus = {
  disabled?: boolean;
  reason?: string;
};

export type PullRequestReviewStatus = {
  approve?: PullRequestReviewActionStatus;
  close?: PullRequestReviewActionStatus;
  comment?: PullRequestReviewActionStatus;
  markReady?: PullRequestReviewActionStatus;
  requestChanges?: PullRequestReviewActionStatus;
};

export type PullRequestMergeCheckStatus = 'failed' | 'neutral' | 'pending' | 'success';

export type PullRequestMergeCheck = {
  detail?: string;
  label: string;
  status: PullRequestMergeCheckStatus;
  url?: string;
};

export type PullRequestMergeOptions = {
  removeSourceBranch: boolean;
  squash: boolean;
};

export type PullRequestCodeQualityFinding = {
  description: string;
  engineName?: string;
  filePath: string;
  fingerprint: string;
  lineNumber: number;
  severity: 'blocker' | 'critical' | 'info' | 'major' | 'minor' | 'unknown';
  status: 'existing' | 'new' | 'resolved';
  url?: string;
};

export type PullRequestMergeState = {
  autoMergeEnabled: boolean;
  canCancelAutoMerge: boolean;
  canMerge: boolean;
  canSetAutoMerge: boolean;
  checks: ReadonlyArray<PullRequestMergeCheck>;
  detailedStatus?: string;
  forceRemoveSourceBranch: boolean;
  mergeError?: string;
  options: PullRequestMergeOptions;
  reason?: string;
  sha: string;
  status: 'blocked' | 'checking' | 'closed' | 'merged' | 'ready' | 'waiting';
  statusLabel: string;
};

export type ReviewSource =
  | {
      type: 'working-tree';
    }
  | {
      ref: string;
      type: 'commit';
    }
  | {
      ref: string;
      type: 'branch';
    }
  | {
      /** Resolved base commit for a branch diff snapshot. */
      baseRef: string;
      /** Resolved head commit for a branch diff snapshot. */
      headRef: string;
      /** Target branch the current branch was compared against. */
      ref: string;
      type: 'branch-diff';
    }
  | {
      /**
       * Resolved base commit for the branch part of the comparison. Optional
       * because the CLI can construct this source from just a branch name
       * (`codiff main`), before merge-base resolution happens; the resolved
       * state's `source` always carries a concrete value.
       */
      baseRef?: string;
      /** Resolved head commit for the branch part of the comparison. See {@link baseRef}. */
      headRef?: string;
      /** Target branch the current branch was compared against. */
      ref: string;
      type: 'branch-working-tree';
    }
  | {
      /** Base ref (left side). For symmetric ranges the diff starts at its merge-base with head. */
      base: string;
      /** Head ref (right side). */
      head: string;
      /** `true` for `base...head` (merge-base), `false` for `base..head` (direct). */
      symmetric: boolean;
      type: 'range';
    }
  | {
      author?: ReviewAuthor;
      canEditDescription?: boolean;
      canEditReviewers?: boolean;
      canEditTitle?: boolean;
      description?: string;
      draft?: boolean;
      headSha?: string;
      host?: string;
      mergeState?: PullRequestMergeState;
      number?: number;
      owner?: string;
      projectPath?: string;
      provider?: 'github' | 'gitlab';
      repo?: string;
      reviewers?: ReadonlyArray<PullRequestReviewer>;
      reviewStatus?: PullRequestReviewStatus;
      title?: string;
      type: 'pull-request';
      url: string;
    };

/** Sources that can be entered from the palette or native application menu. */
export type OpenReviewSourceKind = 'branch' | 'commit' | 'pull-request';

export type HistoryEntry = {
  author: string;
  committedAt: number;
  gravatarUrl?: string;
  parents: ReadonlyArray<string>;
  ref: string;
  scope?: 'base' | 'pull-request';
  subject: string;
};

export type CommitMetadataPerson = {
  date: string;
  email: string;
  gravatarUrl?: string;
  name: string;
};

export type CommitMetadataFile = {
  additions?: number;
  binary: boolean;
  deletions?: number;
  oldPath?: string;
  path: string;
  status: GitFileStatus;
};

export type CommitMetadata = {
  author: CommitMetadataPerson;
  body: string;
  committer: CommitMetadataPerson;
  files: ReadonlyArray<CommitMetadataFile>;
  parents: ReadonlyArray<string>;
  ref: string;
  refs: ReadonlyArray<string>;
  shortRef: string;
  signature: {
    key?: string;
    signer?: string;
    status: string;
  };
  stats: {
    additions: number;
    binaryFiles: number;
    deletions: number;
    files: number;
    renamedFiles: number;
  };
  subject: string;
  trailers: ReadonlyArray<{
    key: string;
    value: string;
  }>;
};

export type RepositoryHistory = {
  entries: ReadonlyArray<HistoryEntry>;
  root: string;
};

export type RepositoryState = {
  branch: string | null;
  codeQualityFindings?: ReadonlyArray<PullRequestCodeQualityFinding>;
  commitMetadata?: CommitMetadata;
  files: ReadonlyArray<ChangedFile>;
  generalComments?: ReadonlyArray<PullRequestGeneralCommentThread>;
  generatedAt: number;
  launchPath: string;
  reviewComments?: ReadonlyArray<PullRequestExistingReviewComment>;
  root: string;
  source: ReviewSource;
};

export type CodiffLaunchOptions = {
  repositoryPathProvided: boolean;
  source?: ReviewSource;
};

export type TerminalHelperStatus = {
  command: string;
  installed: boolean;
  path: string;
};

export type ReviewHunkAnchor = {
  /** Human-readable location, e.g. 'src/App.tsx:311' or 'src/hooks/useHunkOrder.ts (new)'. */
  display: string;
  /** End line on the {@link side} (inclusive). */
  endLine?: number;
  /** Matches {@link DiffSection.id}, e.g. 'src/App.tsx:staged'. */
  sectionId?: string;
  sectionKind?: DiffSection['kind'];
  side?: 'additions' | 'deletions' | 'both';
  /** Start line on the {@link side}. */
  startLine?: number;
};

export type ReviewHunk = {
  added: number;
  additionEnd?: number;
  additionStart?: number;
  anchor: ReviewHunkAnchor;
  deleted: number;
  deletionEnd?: number;
  deletionStart?: number;
  id: string;
  /** `synthetic` hunks represent binary, deferred, or metadata-only review units. */
  kind?: 'patch' | 'synthetic';
  oldPath?: string;
  path: string;
  status: GitFileStatus;
};

/** Shared hunk-backed fields for a stop or support group. */

/** A changed hunk group kept off the main path. */

/** Commit the selected working tree files. */

export type GitIdentity = {
  email: string;
  gravatarUrl?: string;
  name: string;
  username?: string;
};

export type DiffSectionContentRequest = {
  force?: boolean;
  kind: DiffSection['kind'];
  path: string;
  showWhitespace?: boolean;
  source?: ReviewSource;
};

export type DefinitionSearchRequest = {
  identifier: string;
  kind: DiffSection['kind'];
  lineNumber: number;
  path: string;
  side: 'additions' | 'deletions';
  source: ReviewSource;
};

export type DefinitionCandidate = {
  canOpenInEditor: boolean;
  kind: string;
  line: string;
  lineNumber: number;
  path: string;
  side: 'additions' | 'deletions';
};

export type DefinitionSearchResult =
  | {
      candidates: ReadonlyArray<DefinitionCandidate>;
      identifier: string;
      status: 'ready';
    }
  | {
      reason: string;
      status: 'unavailable';
    };

export type DiffImageContentRequest = {
  kind: DiffSection['kind'];
  path: string;
  source?: ReviewSource;
};

export type DiffImageRevision = {
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
};

export type DiffImageContentResult =
  | {
      newImage?: DiffImageRevision;
      oldImage?: DiffImageRevision;
      status: 'ready';
    }
  | {
      reason: string;
      status: 'unavailable';
    };

export type CodiffTheme = 'system' | 'light' | 'dark';

export type CodiffPreferences = {
  codeFontFamily: string;
  codeFontSize: number;
  copyCommentsOnClose: boolean;
  diffStyle: CodiffDiffStyle;
  editorCommand: string;
  expandUnchanged: boolean;
  lastRepositoryPath: string;

  renderMarkdownAs: 'preview' | 'source';
  reviewCommentsPrefix: string;
  showOutdated: boolean;
  showWhitespace: boolean;
  sidebarPosition: 'left' | 'right';
  theme: CodiffTheme;

  wordWrap: boolean;
};

export type ReviewPreferences = Pick<
  CodiffPreferences,
  'codeFontFamily' | 'codeFontSize' | 'diffStyle' | 'showWhitespace' | 'theme' | 'wordWrap'
>;

export type PullRequestReviewComment = {
  anchor?: 'file' | 'line';
  body: string;
  filePath: string;
  lineNumber?: number;
  sectionId?: string;
  side?: 'additions' | 'deletions';
  startLineNumber?: number;
  startSide?: 'additions' | 'deletions';
  threadId?: string;
};

export type PullRequestExistingReviewComment = PullRequestReviewComment & {
  author: ReviewAuthor;
  canDelete?: boolean;
  canEdit?: boolean;
  canReplyThread?: boolean;
  canResolveThread?: boolean;
  id: string;
  isOutdated?: boolean;
  isThreadResolved?: boolean;
  submittedAt?: string;
  url?: string;
};

export type PullRequestGeneralComment = {
  author: ReviewAuthor;
  body: string;
  canDelete?: boolean;
  canEdit?: boolean;
  id: string;
  submittedAt?: string;
  url?: string;
};

export type PullRequestGeneralCommentThread = {
  canReply?: boolean;
  canResolve?: boolean;
  comments: ReadonlyArray<PullRequestGeneralComment>;
  id: string;
  isResolved?: boolean;
};

export type PullRequestReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
