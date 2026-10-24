// @ts-check

const { existsSync } = require('node:fs');
const { basename, dirname, join, relative, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,

  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} = require('electron');
const squirrelStartup = require('electron-squirrel-startup');
const {
  listRepositoryHistory,
  readDiffImageContent,
  readDiffSectionContent,
  readGitIdentity,
  readRepositoryState,

  validateRepositoryPath,
} = require('./git-state.cjs');
const { attachExternalLinkHandling } = require('./external-links.cjs');

const { createRecentRepositories } = require('./recent-repositories.cjs');
const recentRepositories = createRecentRepositories();
const { readKeyboardLayout, watchKeyboardLayout } = require('./keyboard-layout.cjs');

const {
  configToPreferences,
  createDefaultConfig,
  getConfigPath,
  initConfig,
  migrateFromPreferences,
  normalizeCodeFontFamily,
  normalizeCodeFontSize,
  readConfig,
  watchConfig,
  writeConfig,
} = require('./config.cjs');

const { parseReviewUrl, resolveReviewUrl } = require('./review-source.cjs');
const {
  getRepositoryWindowTitle,
  restoreRepositoryWindowTitleAfterLoad,
} = require('./window-title.cjs');
const {
  findMatchingWindowIdentity,
  getWindowIdentity,
  getWindowIdentityForRepositoryState,
} = require('./window-identity.cjs');
const { createPendingCommentsClipboardController } = require('./pending-comments.cjs');
const {
  getCommandLineLaunchOptions,
  getCommandLineRepositoryPath,
  getInitialRepositoryPath,
  getLaunchOptions,
  getLaunchPath,
} = require('./main/command-line.cjs');

const { createEditorOpener } = require('./main/editor.cjs');
const { createDefinitionSearchCoordinator } = require('./definition-search.cjs');
const { createTerminalHelper } = require('./main/terminal-helper.cjs');
const { createWindowRevealController } = require('./window-reveal.cjs');
const {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowState,
  validateWindowStateOnScreen,
  writeWindowState,
} = require('./window-state.cjs');

const {
  createRepositoryWatcherCoordinator,
  readRepositoryWatcherSnapshot,
} = require('./repository-watcher.cjs');

/**
 * @typedef {import('../core/config/types.ts').CodiffConfig} CodiffConfig
 * @typedef {import('../core/types.ts').CodiffLaunchOptions} CodiffLaunchOptions
 * @typedef {import('../core/types.ts').CodiffTheme} CodiffTheme
 * @typedef {import('../core/types.ts').ReviewSource} ReviewSource
 * @typedef {{key: string; repositoryRoot: string; sourceKey: string}} WindowIdentity
 * @typedef {{direction: string; name: string; owner: string; repo: string}} GitHubRemote
 * @typedef {{repositoryPath?: string; launchOptions?: CodiffLaunchOptions}} SingleInstanceAdditionalData
 * @typedef {{args: Array<string>; command: string}} EditorCommand
 * @typedef {{launchOptions: CodiffLaunchOptions; pullRequestNumber: number | null; repositoryPath: string | null}} ParsedCommandLineArguments
 */

const root = dirname(__dirname);
/** @type {Map<number, ReturnType<typeof createWindowRevealController>>} */
const windowRevealControllers = new Map();
/** @type {Map<number, WindowIdentity | null>} */
const windowIdentities = new Map();
/** @type {Map<number, string>} */
const windowRepositories = new Map();
/** @type {Map<number, CodiffLaunchOptions>} */
const windowLaunchOptions = new Map();
/** @type {Map<number, {repositoryPath: string; launchOptions: CodiffLaunchOptions; identity: WindowIdentity | null}>} */
const pendingRepositoryLaunches = new Map();
/** @type {Map<number, number>} */
const repositoryGenerations = new Map();
/** @type {Map<number, string>} */
const watchedRepositoryRoots = new Map();
/** @type {Map<string, CodiffLaunchOptions>} */
const repositoryLaunchHistory = new Map();
/** @type {Map<number, Promise<RepositoryState>>} */
const windowInitialRepositoryStates = new Map();

/** @type {Set<import('electron').BrowserWindow>} */
const openWindows = new Set();
const pendingCommentsClipboardController = createPendingCommentsClipboardController({ clipboard });
/** @type {CodiffConfig} */
let config = createDefaultConfig();

/** @param {string} repositoryPath @param {ReviewSource} [source] */
const readRepositoryStateWithConfig = (repositoryPath, source) =>
  readRepositoryState(repositoryPath, source, {
    showWhitespace: config.settings.showWhitespace,
  });

/** @param {string} repositoryPath @param {CodiffLaunchOptions} launchOptions */
const readInitialRepositoryStateWithConfig = (repositoryPath, launchOptions) =>
  readRepositoryStateWithConfig(repositoryPath, launchOptions.source);

const { getTerminalHelperStatus, installTerminalHelper } = createTerminalHelper({
  app,
  dialog,
  root,
});
const { openFileInEditor } = createEditorOpener({
  getEditorCommand: () => config.settings.editorCommand,
  shell,
});
const definitionSearchCoordinator = createDefinitionSearchCoordinator();

const openConfigFile = async () => {
  initConfig();
  await openFileInEditor(getConfigPath());
};

/** @param {number} webContentsId */
const getWindowRepositoryRoot = (webContentsId) =>
  windowIdentities.get(webContentsId)?.repositoryRoot ||
  windowRepositories.get(webContentsId) ||
  getLaunchPath();

/** @param {number} webContentsId @param {RepositoryState} state */
const storeResolvedRepositoryState = (webContentsId, state) => {
  windowRepositories.set(webContentsId, state.root);
  const browserWindow = BrowserWindow.getAllWindows().find(
    (window) => window.webContents.id === webContentsId,
  );
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.setTitle(getRepositoryWindowTitle(state));
  }
  const launchOptions = windowLaunchOptions.get(webContentsId);
  if (launchOptions) {
    windowLaunchOptions.set(webContentsId, {
      ...launchOptions,
      source: state.source,
    });
  }
  if (launchOptions) {
    repositoryLaunchHistory.set(state.root, { ...launchOptions, source: state.source });
  }
  const identity = getWindowIdentityForRepositoryState(state);
  if (identity) {
    windowIdentities.set(webContentsId, identity);
  }
};

const sendConfigChanged = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('codiff:configChanged', config);
    }
  }
};

/** @param {Partial<CodiffConfig>} nextConfig */
const updateConfig = (nextConfig) => {
  config = {
    keymap: { ...config.keymap, ...nextConfig.keymap },
    settings: {
      ...config.settings,
      ...nextConfig.settings,

      codeFontFamily: normalizeCodeFontFamily(
        nextConfig.settings?.codeFontFamily ?? config.settings.codeFontFamily,
      ),
      codeFontSize: normalizeCodeFontSize(
        nextConfig.settings?.codeFontSize ?? config.settings.codeFontSize,
      ),
    },
  };
  nativeTheme.themeSource = config.settings.theme;
  writeConfig(config);

  sendConfigChanged();
  Menu.setApplicationMenu(buildApplicationMenu());
};

/** @param {CodiffTheme} theme */
const updateTheme = (theme) => {
  updateConfig({ settings: { ...config.settings, theme } });
};

/** @param {number} size */
const setCodeFontSize = (size) => {
  const codeFontSize = normalizeCodeFontSize(size);
  if (config.settings.codeFontSize === codeFontSize) {
    return;
  }

  updateConfig({ settings: { ...config.settings, codeFontSize } });
};

const increaseCodeFontSize = () => {
  setCodeFontSize(config.settings.codeFontSize + 1);
};

const decreaseCodeFontSize = () => {
  setCodeFontSize(config.settings.codeFontSize - 1);
};

const resetCodeFontSize = () => {
  setCodeFontSize(13);
};

/** @param {string} repositoryPath */
const rememberLastRepositoryPath = (repositoryPath) => {
  recentRepositories.remember(repositoryPath);
  if (config.settings.lastRepositoryPath === repositoryPath) {
    return;
  }

  config = {
    ...config,
    settings: {
      ...config.settings,
      lastRepositoryPath: repositoryPath,
    },
  };
  writeConfig(config);
};

/**
 * @param {string} repositoryRoot
 * @param {Iterable<string>} [exactPaths]
 * @param {Iterable<string>} [knownDirtyPaths]
 */
const readSafeRepositoryWatcherSnapshot = async (
  repositoryRoot,
  exactPaths = [],
  knownDirtyPaths = [],
) => {
  try {
    return await readRepositoryWatcherSnapshot(repositoryRoot, exactPaths, knownDirtyPaths);
  } catch (error) {
    return {
      head: `error:${error instanceof Error ? error.message : String(error)}`,
      pathSignatures: {},
      pathVersions: {},
      root: repositoryRoot,
      signature: `error:${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const repositoryWatcherCoordinator = createRepositoryWatcherCoordinator({
  readSnapshot: readSafeRepositoryWatcherSnapshot,
});

/** @param {number} webContentsId @param {string} repositoryPath */
const resetRepositoryWatcher = (webContentsId, repositoryPath) =>
  repositoryWatcherCoordinator.reset(webContentsId, repositoryPath);

/** @param {import('electron').BrowserWindow} browserWindow @param {string} repositoryPath */
const startRepositoryWatcher = (browserWindow, repositoryPath) => {
  const webContentsId = browserWindow.webContents.id;
  watchedRepositoryRoots.set(webContentsId, repositoryPath);
  void repositoryWatcherCoordinator.attach({
    getState: () => ({
      focused: !browserWindow.isDestroyed() && browserWindow.isFocused(),
      visible:
        !browserWindow.isDestroyed() && browserWindow.isVisible() && !browserWindow.isMinimized(),
    }),
    id: webContentsId,
    notify: (root) => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send('codiff:repositoryChanged', { root });
      }
    },
    root: repositoryPath,
  });
};

/** @param {import('electron').BaseWindow | undefined} browserWindow */
const openRepositoryFolder = async (browserWindow) => {
  const options = {
    properties: /** @type {Array<'openDirectory'>} */ (['openDirectory']),
  };
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options);

  if (!result.canceled && result.filePaths[0]) {
    focusOrCreateWindow(result.filePaths[0], { repositoryPathProvided: true });
  }
};

/**
 * Native menus live in the main process, so this event lets the renderer own
 * the actual source dialog and reuse it with the command palette.
 * @param {import('electron').BrowserWindow | undefined} browserWindow
 * @param {import('../core/types.ts').OpenReviewSourceKind} kind
 */
const requestOpenReviewSource = (browserWindow, kind) => {
  if (browserWindow instanceof BrowserWindow && !browserWindow.isDestroyed()) {
    browserWindow.webContents.send('codiff:openReviewSource', kind);
  }
};
/** @returns {import('electron').Menu} */
const buildApplicationMenu = () =>
  Menu.buildFromTemplate(
    /** @type {Array<import('electron').MenuItemConstructorOptions>} */ ([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Codiff',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                {
                  click: (_menuItem, browserWindow) =>
                    requestOpenReviewSource(browserWindow, 'pull-request'),
                  label: 'Open PR',
                },
                {
                  click: (_menuItem, browserWindow) =>
                    requestOpenReviewSource(browserWindow, 'commit'),
                  label: 'Open Commit',
                },
                {
                  click: (_menuItem, browserWindow) =>
                    requestOpenReviewSource(browserWindow, 'branch'),
                  label: 'Open Branch',
                },
                { type: 'separator' },

                { type: 'separator' },
                {
                  click: () => {
                    void openConfigFile();
                  },
                  label: 'Open Config File...',
                },
                { type: 'separator' },
                {
                  click:
                    /** @type {NonNullable<import('electron').MenuItemConstructorOptions['click']>} */ (
                      (_menuItem, browserWindow) => installTerminalHelper(browserWindow)
                    ),
                  label: 'Install Terminal Helper',
                },

                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          ...(process.platform === 'darwin'
            ? []
            : [
                { type: 'separator' },
                {
                  click: () => {
                    void openConfigFile();
                  },
                  label: 'Open Config File...',
                },
                { type: 'separator' },
                {
                  click:
                    /** @type {NonNullable<import('electron').MenuItemConstructorOptions['click']>} */ (
                      (_menuItem, browserWindow) => installTerminalHelper(browserWindow)
                    ),
                  label: 'Install Terminal Helper',
                },

                { type: 'separator' },
              ]),
          {
            accelerator: 'CommandOrControl+O',
            click: (_menuItem, browserWindow) => openRepositoryFolder(browserWindow),
            label: 'Open Folder...',
          },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            accelerator: 'CommandOrControl+F',
            click: (_menuItem, browserWindow) => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.send('codiff:findInDiffs');
              }
            },
            label: 'Find in Diffs',
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Diff',
            submenu: [
              {
                checked: config.settings.diffStyle === 'split',
                click: () => {
                  updateConfig({
                    settings: { ...config.settings, diffStyle: 'split' },
                  });
                },
                label: 'Split',
                type: 'radio',
              },
              {
                checked: config.settings.diffStyle === 'unified',
                click: () => {
                  updateConfig({
                    settings: { ...config.settings, diffStyle: 'unified' },
                  });
                },
                label: 'Unified',
                type: 'radio',
              },
              { type: 'separator' },
              {
                checked: config.settings.wordWrap,
                click: (menuItem) => {
                  updateConfig({
                    settings: { ...config.settings, wordWrap: menuItem.checked },
                  });
                },
                label: 'Word Wrap',
                type: 'checkbox',
              },
              {
                checked: config.settings.showWhitespace,
                click: (menuItem) => {
                  updateConfig({
                    settings: { ...config.settings, showWhitespace: menuItem.checked },
                  });
                },
                label: 'Show Whitespace',
                type: 'checkbox',
              },
              {
                checked: config.settings.expandUnchanged,
                click: (menuItem) => {
                  updateConfig({
                    settings: { ...config.settings, expandUnchanged: menuItem.checked },
                  });
                },
                label: 'Expand Unchanged Lines',
                type: 'checkbox',
              },
              { type: 'separator' },
              {
                label: 'Font Size',
                submenu: [
                  {
                    accelerator: process.platform === 'darwin' ? 'Command+Plus' : 'Control+Plus',
                    click: increaseCodeFontSize,
                    label: 'Increase',
                  },
                  {
                    accelerator: 'CommandOrControl+-',
                    click: decreaseCodeFontSize,
                    label: 'Decrease',
                  },
                  {
                    accelerator: 'CommandOrControl+0',
                    click: resetCodeFontSize,
                    label: 'Reset',
                  },
                ],
              },
            ],
          },
          {
            label: 'Comments',
            submenu: [
              {
                checked: config.settings.showOutdated,
                click: (menuItem) => {
                  updateConfig({
                    settings: { ...config.settings, showOutdated: menuItem.checked },
                  });
                },
                label: 'Show Outdated Comments',
                type: 'checkbox',
              },
              {
                checked: config.settings.copyCommentsOnClose,
                click: (menuItem) => {
                  updateConfig({
                    settings: { ...config.settings, copyCommentsOnClose: menuItem.checked },
                  });
                },
                label: 'Copy Comments on Close',
                type: 'checkbox',
              },
            ],
          },
          {
            label: 'Theme',
            submenu: [
              {
                checked: config.settings.theme === 'system',
                click: () => updateTheme('system'),
                label: 'Match System',
                type: 'radio',
              },
              {
                checked: config.settings.theme === 'light',
                click: () => updateTheme('light'),
                label: 'Light',
                type: 'radio',
              },
              {
                checked: config.settings.theme === 'dark',
                click: () => updateTheme('dark'),
                label: 'Dark',
                type: 'radio',
              },
            ],
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          {
            // In-place refresh handled by the renderer; the window itself is
            // only reloaded via Force Reload below.
            accelerator: 'CommandOrControl+R',
            click: (_menuItem, browserWindow) => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.send('codiff:refreshRequest');
              }
            },
            label: 'Refresh Changes',
          },
          { role: 'forceReload' },
          {
            accelerator: 'CommandOrControl+Alt+J',
            click: (_menuItem, browserWindow) => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.toggleDevTools();
              }
            },
            label: 'Toggle Developer Tools',
          },
        ],
      },
    ]),
  );

let copyingPendingCommentsBeforeQuit = false;
let quitting = false;
let quitAfterCopyingPendingComments = false;

ipcMain.on(
  'codiff:copyPendingCommentsResult',
  pendingCommentsClipboardController.handleCopyPendingCommentsResult,
);

/**
 * @param {string} repositoryPath
 * @param {CodiffLaunchOptions} [launchOptions]
 * @param {WindowIdentity | null} [identity]
 */
const createWindow = (
  repositoryPath,
  launchOptions = { repositoryPathProvided: true },
  identity = getWindowIdentity(repositoryPath, launchOptions),
) => {
  const savedState = readWindowState();
  const validatedState = savedState
    ? validateWindowStateOnScreen(savedState, screen.getAllDisplays())
    : null;

  const display = screen.getPrimaryDisplay();
  const { height, width } = display.workAreaSize;
  const useMacVibrancy = process.platform === 'darwin';
  const useStartupOpacity = process.platform === 'darwin' || process.platform === 'win32';
  const window = new BrowserWindow({
    autoHideMenuBar: process.platform !== 'linux',
    backgroundColor: useMacVibrancy
      ? '#00000000'
      : nativeTheme.shouldUseDarkColors
        ? '#141414'
        : '#ffffff',
    height: validatedState?.height ?? Math.max(720, Math.floor(height * 0.86)),
    minHeight: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    opacity: useStartupOpacity ? 0 : 1,
    show: false,
    titleBarStyle: useMacVibrancy ? 'hiddenInset' : 'default',
    ...(useMacVibrancy
      ? {
          trafficLightPosition: { x: 12, y: 12 },
          transparent: true,
          vibrancy: 'under-window',
          visualEffectState: 'followWindow',
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.cjs'),
    },
    width: validatedState?.width ?? Math.max(1120, Math.floor(width * 0.86)),
    ...(validatedState ? { x: validatedState.x, y: validatedState.y } : { center: true }),
  });

  if (validatedState?.isMaximized) {
    window.maximize();
  }
  if (validatedState?.isFullScreen) {
    window.setFullScreen(true);
  }

  attachExternalLinkHandling(window.webContents, (url) => shell.openExternal(url));

  const webContentsId = window.webContents.id;
  windowRevealControllers.set(
    webContentsId,
    createWindowRevealController(window, useStartupOpacity),
  );
  openWindows.add(window);
  if (identity) {
    windowIdentities.set(webContentsId, identity);
  }
  windowRepositories.set(webContentsId, identity?.repositoryRoot || repositoryPath);
  windowLaunchOptions.set(webContentsId, launchOptions);
  const initialRepositoryStatePromise = readInitialRepositoryStateWithConfig(
    repositoryPath,
    launchOptions,
  );
  const initialRepositoryState = initialRepositoryStatePromise?.then((state) => {
    if (!window.isDestroyed() && !repositoryGenerations.get(webContentsId)) {
      storeResolvedRepositoryState(webContentsId, state);
    }
    return state;
  });
  initialRepositoryState?.catch(() => {});
  if (initialRepositoryState) {
    windowInitialRepositoryStates.set(webContentsId, initialRepositoryState);
  }
  if (
    !launchOptions.source ||
    launchOptions.source.type === 'branch' ||
    launchOptions.source.type === 'branch-working-tree'
  ) {
    void initialRepositoryState
      .then((state) => {
        if (
          (state.source.type === 'working-tree' || state.source.type === 'branch-working-tree') &&
          !window.isDestroyed() &&
          !repositoryGenerations.get(webContentsId)
        ) {
          startRepositoryWatcher(window, state.root);
        }
      })
      .catch(() => {});
  }
  window.on('blur', () => repositoryWatcherCoordinator.visibilityChanged(webContentsId));
  window.on('enter-full-screen', () => {
    window.webContents.send('codiff:windowFullScreenChanged', true);
  });
  window.on('focus', () => repositoryWatcherCoordinator.focus(webContentsId));
  window.on('hide', () => repositoryWatcherCoordinator.visibilityChanged(webContentsId));
  window.on('leave-full-screen', () => {
    window.webContents.send('codiff:windowFullScreenChanged', false);
  });
  window.on('minimize', () => repositoryWatcherCoordinator.visibilityChanged(webContentsId));
  window.on('restore', () => repositoryWatcherCoordinator.focus(webContentsId));
  window.on('show', () => repositoryWatcherCoordinator.focus(webContentsId));
  let allowClose = false;
  let copyingPendingCommentsBeforeClose = false;
  window.on('close', (event) => {
    try {
      const normalBounds = window.getNormalBounds();
      writeWindowState({
        height: normalBounds.height,
        isFullScreen: window.isFullScreen(),
        isMaximized: window.isMaximized(),
        width: normalBounds.width,
        x: normalBounds.x,
        y: normalBounds.y,
      });
    } catch {}

    if (allowClose || quitting || !config.settings.copyCommentsOnClose) {
      return;
    }

    event.preventDefault();
    if (copyingPendingCommentsBeforeClose) {
      return;
    }

    copyingPendingCommentsBeforeClose = true;
    pendingCommentsClipboardController.copyPendingCommentsToClipboard([window]).finally(() => {
      allowClose = true;
      if (!window.isDestroyed()) {
        window.close();
      }
    });
  });
  window.on('closed', () => {
    openWindows.delete(window);
    definitionSearchCoordinator.cancel(webContentsId);
    repositoryWatcherCoordinator.detach(webContentsId);
    watchedRepositoryRoots.delete(webContentsId);

    windowIdentities.delete(webContentsId);
    windowRevealControllers.delete(webContentsId);
    windowInitialRepositoryStates.delete(webContentsId);
    pendingRepositoryLaunches.delete(webContentsId);
    repositoryGenerations.delete(webContentsId);
    windowRepositories.delete(webContentsId);
    windowLaunchOptions.delete(webContentsId);
  });
  window.webContents.on('render-process-gone', () => {
    definitionSearchCoordinator.cancel(webContentsId);
  });
  window.webContents.on('did-finish-load', () => {
    void restoreRepositoryWindowTitleAfterLoad(
      window,
      windowInitialRepositoryStates.get(webContentsId),
    ).catch(() => {});
  });

  const rendererURL = process.env.ELECTRON_RENDERER_URL;
  if (rendererURL) {
    window.loadURL(rendererURL);
  } else {
    window.loadURL(pathToFileURL(join(root, 'dist/index.html')).toString());
  }
};

/** @param {import('electron').BrowserWindow} window */
const focusWindow = (window) => {
  if (windowRevealControllers.get(window.webContents.id)?.isPending()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  window.focus();
};

/** @param {number} webContentsId */
const activatePendingRepositoryLaunch = (webContentsId) => {
  const pending = pendingRepositoryLaunches.get(webContentsId);
  if (!pending) {
    return;
  }
  pendingRepositoryLaunches.delete(webContentsId);
  repositoryGenerations.set(webContentsId, (repositoryGenerations.get(webContentsId) ?? 0) + 1);
  definitionSearchCoordinator.cancel(webContentsId);
  repositoryWatcherCoordinator.detach(webContentsId);
  watchedRepositoryRoots.delete(webContentsId);

  windowInitialRepositoryStates.delete(webContentsId);
  windowIdentities.set(webContentsId, pending.identity);
  windowRepositories.set(webContentsId, pending.identity?.repositoryRoot || pending.repositoryPath);
  windowLaunchOptions.set(webContentsId, pending.launchOptions);
};

/**
 * @param {string} repositoryPath
 * @param {CodiffLaunchOptions} [launchOptions]
 */
const focusOrCreateWindow = (repositoryPath, launchOptions = { repositoryPathProvided: true }) => {
  const identity = getWindowIdentity(repositoryPath, launchOptions);
  {
    const reviewWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (reviewWindow) {
      const id = reviewWindow.webContents.id;
      if (!identity || windowIdentities.get(id)?.key !== identity.key) {
        pendingRepositoryLaunches.set(id, {
          identity,
          launchOptions: {
            ...launchOptions,
            source: launchOptions.source ?? { type: 'working-tree' },
          },
          repositoryPath,
        });
        reviewWindow.reload();
      } else {
        pendingRepositoryLaunches.delete(id);
      }
      focusWindow(reviewWindow);
      return reviewWindow;
    }
  }
  const matchingWebContentsId = findMatchingWindowIdentity(identity, windowIdentities);
  const matchingWindow =
    matchingWebContentsId == null
      ? null
      : BrowserWindow.getAllWindows().find(
          (window) => window.webContents.id === matchingWebContentsId,
        );

  if (matchingWindow) {
    focusWindow(matchingWindow);
    return matchingWindow;
  }

  return createWindow(repositoryPath, launchOptions, identity);
};

const lock =
  !squirrelStartup &&
  app.requestSingleInstanceLock({
    launchOptions: getLaunchOptions(),
    repositoryPath: getLaunchPath(),
  });

if (squirrelStartup || !lock) {
  app.quit();
} else {
  app.setName('Codiff');

  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    const data = /** @type {SingleInstanceAdditionalData} */ (additionalData || {});
    const launchOptions =
      data.launchOptions || getCommandLineLaunchOptions(commandLine, workingDirectory);
    const launchPath = resolve(
      data.repositoryPath || getCommandLineRepositoryPath(commandLine) || workingDirectory,
    );
    focusOrCreateWindow(
      getInitialRepositoryPath(launchPath, launchOptions, config.settings.lastRepositoryPath),
      launchOptions,
    );
  });

  app.on('ready', () => {
    migrateFromPreferences(app.getPath('userData'));
    config = readConfig();
    nativeTheme.themeSource = config.settings.theme;
    Menu.setApplicationMenu(buildApplicationMenu());

    watchKeyboardLayout((layout) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('codiff:keyboardLayoutChanged', layout);
        }
      }
    });

    const launchOptions = getLaunchOptions();
    focusOrCreateWindow(
      getInitialRepositoryPath(getLaunchPath(), launchOptions, config.settings.lastRepositoryPath),
      launchOptions,
    );

    watchConfig((nextConfig) => {
      config = {
        ...nextConfig,
        settings: {
          ...nextConfig.settings,

          codeFontFamily: normalizeCodeFontFamily(nextConfig.settings.codeFontFamily),
          codeFontSize: normalizeCodeFontSize(nextConfig.settings.codeFontSize),
        },
      };

      nativeTheme.themeSource = config.settings.theme;
      sendConfigChanged();
      Menu.setApplicationMenu(buildApplicationMenu());
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const launchOptions = getLaunchOptions();
      focusOrCreateWindow(
        getInitialRepositoryPath(
          getLaunchPath(),
          launchOptions,
          config.settings.lastRepositoryPath,
        ),
        launchOptions,
      );
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    const windows = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed() && !window.webContents.isDestroyed(),
    );

    if (config.settings.copyCommentsOnClose && !quitAfterCopyingPendingComments && windows.length) {
      event.preventDefault();
      if (copyingPendingCommentsBeforeQuit) {
        return;
      }

      copyingPendingCommentsBeforeQuit = true;
      void pendingCommentsClipboardController
        .copyPendingCommentsToClipboard(windows)
        .finally(() => {
          quitAfterCopyingPendingComments = true;
          quitting = true;
          app.quit();
        });
      return;
    }

    quitting = true;
  });
}

ipcMain.handle('codiff:getRepositoryState', async (event, source) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  const generation = repositoryGenerations.get(event.sender.id);
  const launchOptions = windowLaunchOptions.get(event.sender.id);
  const initialState = !source ? windowInitialRepositoryStates.get(event.sender.id) : undefined;
  if (initialState) {
    windowInitialRepositoryStates.delete(event.sender.id);
  }
  const state = initialState
    ? await initialState
    : await readRepositoryStateWithConfig(repositoryPath, source || launchOptions?.source);
  if (repositoryGenerations.get(event.sender.id) !== generation) {
    return state;
  }
  storeResolvedRepositoryState(event.sender.id, state);
  rememberLastRepositoryPath(state.root);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    window &&
    (state.source.type === 'working-tree' || state.source.type === 'branch-working-tree') &&
    watchedRepositoryRoots.get(event.sender.id) !== state.root
  ) {
    startRepositoryWatcher(window, state.root);
  } else {
    void resetRepositoryWatcher(event.sender.id, state.root);
  }
  return state;
});

ipcMain.handle('codiff:resolvePullRequestUrl', (event, value) => {
  const input = typeof value === 'string' ? value.trim() : '';
  const parsedUrl = parseReviewUrl(input);
  if (parsedUrl) {
    return parsedUrl.url;
  }

  const number = input.match(/^#?([1-9]\d*)$/);
  if (!number) {
    throw new Error('Enter a pull request number or a GitHub or GitLab pull request link.');
  }

  // Reuse the CLI resolver so a bare number follows the repository's preferred remote.
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return resolveReviewUrl(repositoryPath, Number(number[1]));
});

ipcMain.handle('codiff:getLaunchOptions', (event) => {
  activatePendingRepositoryLaunch(event.sender.id);
  return windowLaunchOptions.get(event.sender.id) || { repositoryPathProvided: false };
});

ipcMain.handle('codiff:getTerminalHelperStatus', () => getTerminalHelperStatus());

ipcMain.handle('codiff:installTerminalHelper', async (event) => {
  await installTerminalHelper(BrowserWindow.fromWebContents(event.sender));
  return getTerminalHelperStatus();
});

ipcMain.handle('codiff:getDiffSectionContent', async (event, request) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return readDiffSectionContent(repositoryPath, {
    ...request,
    showWhitespace: request?.showWhitespace ?? config.settings.showWhitespace,
  });
});

ipcMain.handle('codiff:getDiffImageContent', async (event, request) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return readDiffImageContent(repositoryPath, request);
});

ipcMain.handle('codiff:getRepositoryHistory', async (event, limit, source) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return listRepositoryHistory(repositoryPath, limit, source);
});

ipcMain.handle('codiff:getGitIdentity', async (event) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return readGitIdentity(repositoryPath);
});

ipcMain.handle('codiff:getPreferences', () => configToPreferences(config));

ipcMain.handle('codiff:getConfig', () => config);

ipcMain.handle('codiff:getKeyboardLayout', () => readKeyboardLayout());

ipcMain.handle('codiff:isWindowFullScreen', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window?.isFullScreen() ?? false;
});

ipcMain.on('codiff:windowReady', (event) => {
  windowRevealControllers.get(event.sender.id)?.markContentReady();
});

ipcMain.handle('codiff:setDiffStyle', (_event, value) => {
  updateConfig({
    settings: {
      ...config.settings,
      diffStyle: value === 'unified' ? 'unified' : 'split',
    },
  });
});

ipcMain.handle('codiff:setShowOutdated', (_event, value) => {
  updateConfig({ settings: { ...config.settings, showOutdated: Boolean(value) } });
});

ipcMain.handle('codiff:setWordWrap', (_event, value) => {
  updateConfig({ settings: { ...config.settings, wordWrap: Boolean(value) } });
});

ipcMain.handle('codiff:increaseCodeFontSize', () => {
  increaseCodeFontSize();
});

ipcMain.handle('codiff:decreaseCodeFontSize', () => {
  decreaseCodeFontSize();
});

ipcMain.handle('codiff:resetCodeFontSize', () => {
  resetCodeFontSize();
});

ipcMain.handle('codiff:openConfigFile', () => openConfigFile());

ipcMain.handle('codiff:showRepositoryMenu', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return;
  }
  const current = getWindowRepositoryRoot(event.sender.id);
  const paths = [...new Set([current, ...recentRepositories.list()])];
  Menu.buildFromTemplate([
    ...paths.map((path) => ({
      checked: path === current,
      click: () =>
        focusOrCreateWindow(
          path,
          repositoryLaunchHistory.get(path) ?? { repositoryPathProvided: true },
        ),
      enabled: existsSync(path),
      label: `${basename(path)} — ${path}`,
      type: /** @type {const} */ ('radio'),
    })),
    { type: 'separator' },
    { label: 'Open Folder…', click: () => openRepositoryFolder(window) },
  ]).popup({ window });
});

ipcMain.handle('codiff:openRepositoryFolder', (event) =>
  openRepositoryFolder(BrowserWindow.fromWebContents(event.sender) ?? undefined),
);

ipcMain.handle('codiff:findDefinitions', (event, request) =>
  definitionSearchCoordinator.find(
    event.sender.id,
    getWindowRepositoryRoot(event.sender.id),
    request,
  ),
);

ipcMain.handle('codiff:openFile', async (event, filePath, lineNumber) => {
  const repositoryRoot = getWindowRepositoryRoot(event.sender.id);
  const repositoryFilePath = validateRepositoryPath(filePath);
  const absolutePath = resolve(repositoryRoot, repositoryFilePath);

  if (existsSync(absolutePath)) {
    await openFileInEditor(absolutePath, {
      lineNumber: Number.isSafeInteger(lineNumber) && lineNumber > 0 ? lineNumber : undefined,
      repoPath: repositoryRoot,
    });
  } else {
    await shell.openPath(repositoryRoot);
  }
});

ipcMain.handle('codiff:showInFolder', (event, filePath) => {
  const repositoryRoot = getWindowRepositoryRoot(event.sender.id);
  const repositoryFilePath = validateRepositoryPath(filePath);
  const absolutePath = resolve(repositoryRoot, repositoryFilePath);

  if (existsSync(absolutePath)) {
    shell.showItemInFolder(absolutePath);
  } else {
    void shell.openPath(repositoryRoot);
  }
});

ipcMain.handle('codiff:getRelativePath', (event, filePath) =>
  relative(getWindowRepositoryRoot(event.sender.id), filePath),
);
