import type { CodeViewHandle } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import type {
  ChangedFile,
  DiffSection,
  PullRequestCodeQualityFinding,
  PullRequestExistingReviewComment,
  ReviewSource,
} from '../types.ts';

export type ReviewCommentAnnotationMetadata = {
  commentIds: ReadonlyArray<string>;
  type: 'review-comment';
};

export type CodeQualityAnnotationMetadata = {
  finding: PullRequestCodeQualityFinding;
  type: 'code-quality';
};

type MarkdownPreviewAnnotationMetadata = {
  contents: string;
  editing: boolean;
  layoutKey: string;
  oldContents?: string;
  path: string;
  sectionId: string;
  type: 'markdown-preview';
};

type ImagePreviewAnnotationMetadata = {
  path: string;
  sectionId: string;
  type: 'image-preview';
};

type WalkthroughHeaderAnnotationMetadata = {
  header: ReactNode;
  type: 'walkthrough-header';
};

export type ReviewAnnotationMetadata =
  | CodeQualityAnnotationMetadata
  | ImagePreviewAnnotationMetadata
  | MarkdownPreviewAnnotationMetadata
  | ReviewCommentAnnotationMetadata
  | WalkthroughHeaderAnnotationMetadata;

export type CodeViewInstance = NonNullable<
  ReturnType<CodeViewHandle<ReviewAnnotationMetadata, undefined>['getInstance']>
>;

export type DiffSearchMatch = {
  filePath: string;
  itemId: string;
  lineNumber?: number;
  side?: 'additions' | 'deletions';
};

export type DiffSearchResult = {
  file: ChangedFile;
  matchCount: number;
  matches: ReadonlyArray<DiffSearchMatch>;
};

export type ReviewScrollBehavior = 'instant' | 'smooth';

export type ReviewScrollTarget = {
  behavior?: ReviewScrollBehavior;
  blockId?: string;
  commentId?: string;
  path?: string;
  request: number;
};

export type ReviewIdentity = {
  coverage?: {
    allHunkIds: ReadonlyArray<string>;
    file: { fingerprint: string; key: string };
    hunkIds: ReadonlyArray<string>;
  };
  fingerprint: string;
  key: string;
};

export type DiffLineCount = {
  additions: number;
  countable: boolean;
  deletions: number;
};

export type ReviewComment = {
  anchor?: 'file' | 'line';
  author?: PullRequestExistingReviewComment['author'];
  body: string;
  canDelete?: boolean;
  canEdit?: boolean;
  canReplyThread?: boolean;
  canResolveThread?: boolean;

  filePath: string;
  id: string;
  isOutdated?: boolean;
  isReadOnly?: boolean;
  isThreadResolved?: boolean;
  lineNumber?: number;
  remoteSubmit?: {
    error?: string;
    status: 'error' | 'submitting';
  };
  sectionId: string;
  side?: 'additions' | 'deletions';
  startLineNumber?: number;
  startSide?: 'additions' | 'deletions';
  submittedAt?: string;
  threadId?: string;
  url?: string;
};

export type SidebarMode = 'tree' | 'history';

export type PullRequestSource = Extract<ReviewSource, { type: 'pull-request' }>;

export type SourceSession = {
  collapsed: Set<string>;
  expandedReviewKeys: Set<string>;

  reviewComments: ReadonlyArray<ReviewComment>;
  selectedPath: string | null;
  viewed: Record<string, string>;
};

export type RepositoryLoadError = {
  kind: 'generic' | 'not-a-repository';
  message: string;
};

export type CodeViewItemMetadata = {
  blockId: string;
  canEditMarkdown: boolean;
  canRenderMarkdown: boolean;
  comments: ReadonlyArray<ReviewComment>;
  file: ChangedFile;
  isCollapsed: boolean;
  isMarkdownPreview: boolean;
  isSelected: boolean;
  isViewed: boolean;
  lineCount: DiffLineCount;
  note?: string;
  reviewIdentity: ReviewIdentity;
  section: DiffSection;
  sectionCount: number;
};
