// @ts-check

const { contextBridge, ipcRenderer } = require('electron');

// Initialize Chromium's storage connection before showing the native window
// can block the renderer's first synchronous settings read.
try {
  void localStorage.length;
  void sessionStorage.length;
} catch {
  // The bridge must still load when Chromium storage is unavailable.
}

const launchOptions = ipcRenderer.invoke('codiff:getLaunchOptions');
/** @type {Promise<import('../core/config/types.ts').CodiffConfig> | undefined} */
let initialConfig = ipcRenderer.invoke('codiff:getConfig');
initialConfig.catch(() => {});
/** @type {Promise<import('../core/types.ts').RepositoryState | undefined> | undefined} */
let initialRepositoryState = launchOptions.then(() =>
  ipcRenderer.invoke('codiff:getRepositoryState'),
);
initialRepositoryState.catch(() => {});

const applyPlatformAttribute = () => {
  document.documentElement?.setAttribute('data-codiff-platform', process.platform);
};

if (document.documentElement) {
  applyPlatformAttribute();
} else {
  window.addEventListener('DOMContentLoaded', applyPlatformAttribute, { once: true });
}

/** @type {Window['codiff']} */
const codiff = {
  getConfig: () => {
    const initial = initialConfig;
    initialConfig = undefined;
    return initial ?? ipcRenderer.invoke('codiff:getConfig');
  },
  decreaseCodeFontSize: () => ipcRenderer.invoke('codiff:decreaseCodeFontSize'),
  getDiffSectionContent: (request) => ipcRenderer.invoke('codiff:getDiffSectionContent', request),

  getDiffImageContent: (request) => ipcRenderer.invoke('codiff:getDiffImageContent', request),
  getGitIdentity: () => ipcRenderer.invoke('codiff:getGitIdentity'),
  getKeyboardLayout: () => ipcRenderer.invoke('codiff:getKeyboardLayout'),
  getLaunchOptions: () => launchOptions,

  getPreferences: () => ipcRenderer.invoke('codiff:getPreferences'),

  getRepositoryHistory: (limit, source) =>
    ipcRenderer.invoke('codiff:getRepositoryHistory', limit, source),
  getRepositoryState: (source) => {
    const initial = source ? undefined : initialRepositoryState;
    initialRepositoryState = undefined;
    return initial
      ? initial.then((state) => state ?? ipcRenderer.invoke('codiff:getRepositoryState', source))
      : ipcRenderer.invoke('codiff:getRepositoryState', source);
  },
  getTerminalHelperStatus: () => ipcRenderer.invoke('codiff:getTerminalHelperStatus'),

  installTerminalHelper: () => ipcRenderer.invoke('codiff:installTerminalHelper'),
  increaseCodeFontSize: () => ipcRenderer.invoke('codiff:increaseCodeFontSize'),
  isWindowFullScreen: () => ipcRenderer.invoke('codiff:isWindowFullScreen'),

  markWindowReady: () => ipcRenderer.send('codiff:windowReady'),
  onConfigChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {import('../core/config/types.ts').CodiffConfig} nextConfig */
    const listener = (_event, nextConfig) => callback(nextConfig);
    ipcRenderer.on('codiff:configChanged', listener);
    return () => ipcRenderer.removeListener('codiff:configChanged', listener);
  },
  onCopyPendingCommentsRequest: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {number} requestId */
    const listener = (_event, requestId) => {
      Promise.resolve(callback()).then(
        (markdown) => {
          ipcRenderer.send(
            'codiff:copyPendingCommentsResult',
            requestId,
            typeof markdown === 'string' ? markdown : '',
          );
        },
        () => {
          ipcRenderer.send('codiff:copyPendingCommentsResult', requestId, '');
        },
      );
    };
    ipcRenderer.on('codiff:copyPendingCommentsRequest', listener);
    return () => ipcRenderer.removeListener('codiff:copyPendingCommentsRequest', listener);
  },
  onFindInDiffs: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('codiff:findInDiffs', listener);
    return () => ipcRenderer.removeListener('codiff:findInDiffs', listener);
  },
  onKeyboardLayoutChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {import('../core/config/keyboard-layout.ts').NativeKeyboardLayout} layout */
    const listener = (_event, layout) => callback(layout);
    ipcRenderer.on('codiff:keyboardLayoutChanged', listener);
    return () => ipcRenderer.removeListener('codiff:keyboardLayoutChanged', listener);
  },
  onOpenReviewSource: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {import('../core/types.ts').OpenReviewSourceKind} kind */
    const listener = (_event, kind) => callback(kind);
    ipcRenderer.on('codiff:openReviewSource', listener);
    return () => ipcRenderer.removeListener('codiff:openReviewSource', listener);
  },

  onWindowFullScreenChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {boolean} isFullScreen */
    const listener = (_event, isFullScreen) => callback(Boolean(isFullScreen));
    ipcRenderer.on('codiff:windowFullScreenChanged', listener);
    return () => ipcRenderer.removeListener('codiff:windowFullScreenChanged', listener);
  },
  onRepositoryChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {{root: string}} change */
    const listener = (_event, change) => callback(change);
    ipcRenderer.on('codiff:repositoryChanged', listener);
    return () => ipcRenderer.removeListener('codiff:repositoryChanged', listener);
  },

  onRefreshRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('codiff:refreshRequest', listener);
    return () => ipcRenderer.removeListener('codiff:refreshRequest', listener);
  },

  findDefinitions: (request) => ipcRenderer.invoke('codiff:findDefinitions', request),
  openConfigFile: () => ipcRenderer.invoke('codiff:openConfigFile'),

  openFile: (path, lineNumber) => ipcRenderer.invoke('codiff:openFile', path, lineNumber),
  showRepositoryMenu: () => ipcRenderer.invoke('codiff:showRepositoryMenu'),
  openRepositoryFolder: () => ipcRenderer.invoke('codiff:openRepositoryFolder'),
  resolvePullRequestUrl: (value) => ipcRenderer.invoke('codiff:resolvePullRequestUrl', value),
  setDiffStyle: (value) => ipcRenderer.invoke('codiff:setDiffStyle', value),
  setShowOutdated: (value) => ipcRenderer.invoke('codiff:setShowOutdated', value),
  setWordWrap: (value) => ipcRenderer.invoke('codiff:setWordWrap', value),

  resetCodeFontSize: () => ipcRenderer.invoke('codiff:resetCodeFontSize'),

  showInFolder: (path) => ipcRenderer.invoke('codiff:showInFolder', path),
};

contextBridge.exposeInMainWorld('codiff', codiff);
