import type { NativeKeyboardLayout } from './config/keyboard-layout.ts';
import type { CodiffConfig } from './config/types.ts';
import type {
  CodiffLaunchOptions,
  CodiffPreferences,
  DefinitionSearchRequest,
  DefinitionSearchResult,
  DiffImageContentRequest,
  DiffImageContentResult,
  DiffSectionContentRequest,
  GitIdentity,
  OpenReviewSourceKind,
  RepositoryHistory,
  RepositoryState,
  ReviewSource,
  TerminalHelperStatus,
} from './types.ts';

declare module '*.css';

declare global {
  interface Window {
    codiff: {
      decreaseCodeFontSize: () => Promise<void>;

      findDefinitions: (request: DefinitionSearchRequest) => Promise<DefinitionSearchResult>;

      getConfig: () => Promise<CodiffConfig>;
      getDiffImageContent: (request: DiffImageContentRequest) => Promise<DiffImageContentResult>;
      getDiffSectionContent: (request: DiffSectionContentRequest) => Promise<DiffSection>;

      getGitIdentity: () => Promise<GitIdentity>;
      getKeyboardLayout: () => Promise<NativeKeyboardLayout | null>;
      getLaunchOptions: () => Promise<CodiffLaunchOptions>;

      getPreferences: () => Promise<CodiffPreferences>;

      getRepositoryHistory: (limit?: number, source?: ReviewSource) => Promise<RepositoryHistory>;
      getRepositoryState: (source?: ReviewSource) => Promise<RepositoryState>;
      getTerminalHelperStatus: () => Promise<TerminalHelperStatus>;

      increaseCodeFontSize: () => Promise<void>;

      installTerminalHelper: () => Promise<TerminalHelperStatus>;
      isWindowFullScreen: () => Promise<boolean>;

      markWindowReady: () => void;

      onConfigChanged: (callback: (config: CodiffConfig) => void) => () => void;
      onCopyPendingCommentsRequest: (callback: () => string | Promise<string>) => () => void;
      onFindInDiffs: (callback: () => void) => () => void;
      onKeyboardLayoutChanged: (callback: (layout: NativeKeyboardLayout) => void) => () => void;

      onOpenReviewSource: (callback: (kind: OpenReviewSourceKind) => void) => () => void;

      onRefreshRequest: (callback: () => void) => () => void;
      onRepositoryChanged: (callback: (change: { root: string }) => void) => () => void;

      onWindowFullScreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
      openConfigFile: () => Promise<void>;
      openFile: (path: string, lineNumber?: number) => Promise<void>;

      openRepositoryFolder: () => Promise<void>;
      resetCodeFontSize: () => Promise<void>;
      resolvePullRequestUrl: (value: string) => Promise<string>;

      setDiffStyle: (value: CodiffPreferences['diffStyle']) => Promise<void>;
      setShowOutdated: (value: boolean) => Promise<void>;
      setWordWrap: (value: boolean) => Promise<void>;

      showInFolder: (path: string) => Promise<void>;

      showRepositoryMenu: () => Promise<void>;
    };
  }
}
