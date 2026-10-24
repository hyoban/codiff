import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vite-plus/test';

const source = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
const switching = source.slice(
  source.indexOf('const activatePendingRepositoryLaunch ='),
  source.indexOf('const lock ='),
);
const makeContext = () => {
  const window = { isDestroyed: () => false, reload: vi.fn(), webContents: { id: 1 } };
  const context = {
    BrowserWindow: { getAllWindows: () => [window] },

    createWindow: vi.fn(),
    definitionSearchCoordinator: { cancel: vi.fn() },
    findMatchingWindowIdentity: () => null,
    focusWindow: vi.fn(),
    getWindowIdentity: (root: string) => ({ key: root, repositoryRoot: root }),
    pendingRepositoryLaunches: new Map(),

    readInitialRepositoryStateWithConfig: vi.fn(),

    repositoryGenerations: new Map(),
    repositoryWatcherCoordinator: { detach: vi.fn() },
    watchedRepositoryRoots: new Map([[1, '/first']]),
    windowIdentities: new Map([[1, { key: '/first', repositoryRoot: '/first' }]]),
    windowInitialRepositoryStates: new Map([[1, Promise.resolve({})]]),
    windowLaunchOptions: new Map([[1, { repositoryPathProvided: true }]]),
    windowRepositories: new Map([[1, '/first']]),
  };
  const api = runInNewContext(
    `${switching}\n({activatePendingRepositoryLaunch, focusOrCreateWindow});`,
    context,
  ) as {
    activatePendingRepositoryLaunch: (id: number) => void;
    focusOrCreateWindow: (path: string) => unknown;
  };
  return { api, context, window };
};

test('opening another project reuses the window and defers context changes until renderer startup', () => {
  const { api, context, window } = makeContext();
  expect(api.focusOrCreateWindow('/second')).toBe(window);
  expect(context.createWindow).not.toHaveBeenCalled();
  expect(window.reload).toHaveBeenCalledOnce();
  expect(context.windowRepositories.get(1)).toBe('/first');
  expect(context.windowInitialRepositoryStates.has(1)).toBe(true);
  api.activatePendingRepositoryLaunch(1);
  expect(context.windowRepositories.get(1)).toBe('/second');
  expect(context.windowInitialRepositoryStates.has(1)).toBe(false);
  expect(context.windowLaunchOptions.get(1)).toEqual({
    repositoryPathProvided: true,
    source: { type: 'working-tree' },
  });
  expect(context.repositoryWatcherCoordinator.detach).toHaveBeenCalledWith(1);
  expect(context.definitionSearchCoordinator.cancel).toHaveBeenCalledWith(1);

  expect(context.repositoryGenerations.get(1)).toBe(1);
});

test('opening the active project focuses it without reloading', () => {
  const { api, context, window } = makeContext();
  api.focusOrCreateWindow('/first');
  expect(window.reload).not.toHaveBeenCalled();
  expect(context.createWindow).not.toHaveBeenCalled();
  expect(context.focusWindow).toHaveBeenCalledWith(window);
});

test('loading a switched project starts its watcher and stale loads cannot overwrite it', async () => {
  const { context, window } = makeContext();
  const handlerSource = source.slice(
    source.indexOf("ipcMain.handle('codiff:getRepositoryState'"),
    source.indexOf("ipcMain.handle('codiff:resolvePullRequestUrl'"),
  );
  let handler: (event: { sender: { id: number } }) => Promise<unknown> = async () => {};
  const storeResolvedRepositoryState = vi.fn();
  const startRepositoryWatcher = vi.fn();
  const state = { root: '/second', source: { type: 'working-tree' } };
  const readRepositoryStateWithConfig = vi.fn(async () => state);
  context.windowInitialRepositoryStates.clear();
  context.windowRepositories.set(1, '/second');
  runInNewContext(handlerSource, {
    ...context,
    BrowserWindow: { fromWebContents: () => window },
    getLaunchPath: () => '/first',
    ipcMain: {
      handle: (_name: string, callback: typeof handler) => {
        handler = callback;
      },
    },
    readRepositoryStateWithConfig,
    rememberLastRepositoryPath: vi.fn(),
    resetRepositoryWatcher: vi.fn(),
    startRepositoryWatcher,
    storeResolvedRepositoryState,
  });
  await handler({ sender: { id: 1 } });
  expect(startRepositoryWatcher).toHaveBeenCalledWith(window, '/second');
  storeResolvedRepositoryState.mockClear();
  let resolveState: (value: typeof state) => void = () => {};
  readRepositoryStateWithConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveState = resolve;
      }),
  );
  const loading = handler({ sender: { id: 1 } });
  context.repositoryGenerations.set(1, 2);
  resolveState(state);
  await loading;
  expect(storeResolvedRepositoryState).not.toHaveBeenCalled();
});
