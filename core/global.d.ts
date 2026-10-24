import type { NativeKeyboardLayout } from './config/keyboard-layout.ts';
import type { CodiffConfig } from './config/types.ts';
import type {
  CodiffFeatureFlags,
  CodiffLaunchOptions,
  CodiffMarkdownDocument,
  CodiffPreferences,
  DefinitionSearchRequest,
  DefinitionSearchResult,
  DiffImageContentRequest,
  DiffImageContentResult,
  DiffSection,
  DiffSectionContentRequest,
  GitIdentity,
  OpenReviewSourceKind,
  PlanHandoffStatus,
  PlanReview,
  RepositoryHistory,
  RepositoryFileDocument,
  RepositoryState,
  ReviewSource,
  SaveMarkdownDocumentRequest,
  SaveMarkdownDocumentResult,
  SaveRepositoryFileRequest,
  SaveRepositoryFileResult,
  SharePlanResult,
  SubmitPullRequestCommentRequest,
  PullRequestExistingReviewComment,
  SubmitPullRequestReviewRequest,
  TerminalHelperStatus,
  CommitRequest,
  CommitResult,
} from './types.ts';

declare module '*.css';

declare global {
  interface Window {
    codiff: {
      completePlan: (review: PlanReview, status: PlanHandoffStatus) => Promise<void>;
      createCommit: (request: CommitRequest) => Promise<CommitResult>;
      decreaseCodeFontSize: () => Promise<void>;

      findDefinitions: (request: DefinitionSearchRequest) => Promise<DefinitionSearchResult>;

      getConfig: () => Promise<CodiffConfig>;
      getDiffImageContent: (request: DiffImageContentRequest) => Promise<DiffImageContentResult>;
      getDiffSectionContent: (request: DiffSectionContentRequest) => Promise<DiffSection>;
      getFeatureFlags: () => Promise<CodiffFeatureFlags>;
      getGitIdentity: () => Promise<GitIdentity>;
      getKeyboardLayout: () => Promise<NativeKeyboardLayout | null>;
      getLaunchOptions: () => Promise<CodiffLaunchOptions>;
      getMarkdownDocument: (request: {
        kind: CodiffMarkdownDocument['kind'];
        path: string;
      }) => Promise<CodiffMarkdownDocument>;

      getPlanReview: () => Promise<PlanReview | null>;
      getPreferences: () => Promise<CodiffPreferences>;
      getRepositoryFile: (path: string) => Promise<RepositoryFileDocument>;
      getRepositoryHistory: (limit?: number, source?: ReviewSource) => Promise<RepositoryHistory>;
      getRepositoryState: (source?: ReviewSource) => Promise<RepositoryState>;
      getTerminalHelperStatus: () => Promise<TerminalHelperStatus>;

      increaseCodeFontSize: () => Promise<void>;

      installTerminalHelper: () => Promise<TerminalHelperStatus>;
      isWindowFullScreen: () => Promise<boolean>;
      markPlanReady: () => Promise<void>;
      markWindowReady: () => void;
      onCommitOutput: (callback: (chunk: string) => void) => () => void;
      onConfigChanged: (callback: (config: CodiffConfig) => void) => () => void;
      onCopyPendingCommentsRequest: (callback: () => string | Promise<string>) => () => void;
      onFindInDiffs: (callback: () => void) => () => void;
      onKeyboardLayoutChanged: (callback: (layout: NativeKeyboardLayout) => void) => () => void;
      onMarkdownDocumentChanged: (
        callback: (
          change:
            | { deleted: true; id: string }
            | { deleted: false; document: CodiffMarkdownDocument; id: string },
        ) => void,
      ) => () => void;
      onOpenReviewSource: (callback: (kind: OpenReviewSourceKind) => void) => () => void;
      onPlanCloseRequested: (callback: () => void) => () => void;
      onRefreshRequest: (callback: () => void) => () => void;
      onRepositoryChanged: (callback: (change: { root: string }) => void) => () => void;

      onWindowFullScreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
      openConfigFile: () => Promise<void>;
      openFile: (path: string, lineNumber?: number) => Promise<void>;

      openRepositoryFolder: () => Promise<void>;
      resetCodeFontSize: () => Promise<void>;
      resolvePullRequestUrl: (value: string) => Promise<string>;
      saveMarkdownDocument: (
        request: SaveMarkdownDocumentRequest,
      ) => Promise<SaveMarkdownDocumentResult>;
      savePlanReview: (review: PlanReview) => Promise<PlanReview>;
      saveRepositoryFile: (request: SaveRepositoryFileRequest) => Promise<SaveRepositoryFileResult>;
      setDiffStyle: (value: CodiffPreferences['diffStyle']) => Promise<void>;
      setShowOutdated: (value: boolean) => Promise<void>;
      setWordWrap: (value: boolean) => Promise<void>;
      sharePlan: (review: PlanReview) => Promise<SharePlanResult>;
      showInFolder: (path: string) => Promise<void>;

      showRepositoryMenu: () => Promise<void>;
      submitPullRequestComment: (
        request: SubmitPullRequestCommentRequest,
      ) => Promise<PullRequestExistingReviewComment>;
      submitPullRequestReview: (request: SubmitPullRequestReviewRequest) => Promise<void>;
    };
  }
}
