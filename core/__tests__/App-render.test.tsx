/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import App from '../App.tsx';
import { createDefaultConfig, defaultSettings } from '../config/defaults.ts';
import {
  consumeReloadSelection,
  getReloadSelectionPath,
  writeReloadSelection,
} from '../lib/reload-selection.ts';
import type {
  ChangedFile,
  CommitMetadata,
  PlanReview,
  RepositoryState,
  ReviewSource,
} from '../types.ts';
import { createChangedFile } from './helpers/fixtures.ts';
import { renderReact, setInputValue, waitFor } from './helpers/react.tsx';

const reactActEnvironment = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserver;
  Worker?: typeof Worker;
};
reactActEnvironment.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};
HTMLElement.prototype.scrollBy ??= function scrollBy() {};
HTMLElement.prototype.scrollTo ??= function scrollTo() {};
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
class StubWorker extends EventTarget {
  constructor(_scriptURL: string | URL, _options?: WorkerOptions) {
    super();
  }
  onerror = null;
  onmessage = null;
  postMessage() {}
  terminate() {}
}
reactActEnvironment.Worker ??= StubWorker as unknown as typeof Worker;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.style.removeProperty('--font-diff-line-height');
  document.documentElement.style.removeProperty('--font-diff-mono');
  document.documentElement.style.removeProperty('--font-diff-size');
});

const repositoryState = {
  branch: 'main',
  files: [],
  generatedAt: 1,
  launchPath: '/repo',
  root: '/repo',
  source: { type: 'working-tree' },
} satisfies RepositoryState;

const createCommitMetadataFixture = (body: string): CommitMetadata => ({
  author: {
    date: '2026-01-01T12:00:00Z',
    email: 'author@example.com',
    gravatarUrl: 'https://www.gravatar.com/avatar/fallback',
    name: 'Author',
  },
  body,
  committer: {
    date: '2026-01-01T13:00:00Z',
    email: 'committer@example.com',
    name: 'Committer',
  },
  files: [
    {
      additions: 1,
      binary: false,
      deletions: 1,
      path: 'src/app.ts',
      status: 'modified',
    },
  ],
  parents: ['parent-sha'],
  ref: 'abc1234',
  refs: ['main'],
  shortRef: 'abc1234',
  signature: {
    key: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789',
    signer: 'signer@example.test',
    status: 'G',
  },
  stats: {
    additions: 1,
    binaryFiles: 0,
    deletions: 1,
    files: 1,
    renamedFiles: 0,
  },
  subject: 'Commit subject',
  trailers: [
    {
      key: 'Co-authored-by',
      value: 'Second Author <second@example.com>',
    },
  ],
});

const createCodiffMock = (overrides: Partial<Window['codiff']> = {}): Window['codiff'] => ({
  completePlan: vi.fn(async () => {}),
  createCommit: vi.fn(async () => ({
    hash: '0000000000000000000000000000000000000000',
    status: 'committed' as const,
  })),
  decreaseCodeFontSize: vi.fn(async () => {}),

  findDefinitions: vi.fn(async (request) => ({
    candidates: [],
    identifier: request.identifier,
    status: 'ready' as const,
  })),

  getConfig: vi.fn(async () => createDefaultConfig()),
  getDiffImageContent: vi.fn(async () => ({
    reason: 'Unavailable in tests.',
    status: 'unavailable' as const,
  })),
  getDiffSectionContent: vi.fn(async () => {
    throw new Error('Unexpected diff section load.');
  }),
  getFeatureFlags: vi.fn(async () => ({
    planSharing: false,
  })),
  getGitIdentity: vi.fn(async () => ({
    email: 'reviewer@example.com',
    name: 'Reviewer',
  })),
  getKeyboardLayout: vi.fn(async () => null),
  getLaunchOptions: vi.fn(async () => ({
    repositoryPathProvided: true,
  })),
  getMarkdownDocument: vi.fn(async ({ kind, path }) => ({
    content: '# Plan\n',
    id: `${kind}:${path}`,
    kind,
    path,
    version: 'version',
  })),

  getPlanReview: vi.fn(async () => null),
  getPreferences: vi.fn(async () => ({
    codeFontFamily: defaultSettings.codeFontFamily,
    codeFontSize: defaultSettings.codeFontSize,
    copyCommentsOnClose: true,
    diffStyle: 'split' as const,
    editorCommand: '',
    expandUnchanged: false,
    lastRepositoryPath: '/repo',

    renderMarkdownAs: defaultSettings.renderMarkdownAs,
    reviewCommentsPrefix: defaultSettings.reviewCommentsPrefix,
    showOutdated: false,
    showWhitespace: false,
    sidebarPosition: defaultSettings.sidebarPosition,
    theme: 'system' as const,

    wordWrap: false,
  })),
  getRepositoryFile: vi.fn(async (path) => ({
    content: 'new\n',
    path,
    root: '/repo',
    version: 'version',
  })),
  getRepositoryHistory: vi.fn(async () => ({
    entries: [],
    root: '/repo',
  })),
  getRepositoryState: vi.fn(async () => repositoryState),
  getTerminalHelperStatus: vi.fn(async () => ({
    command: 'codiff',
    installed: true,
    path: '/usr/local/bin/codiff',
  })),

  increaseCodeFontSize: vi.fn(async () => {}),

  installTerminalHelper: vi.fn(async () => ({
    command: 'codiff',
    installed: true,
    path: '/usr/local/bin/codiff',
  })),
  isWindowFullScreen: vi.fn(async () => false),
  markPlanReady: vi.fn(async () => {}),
  markWindowReady: vi.fn(),
  onCommitOutput: vi.fn(() => () => {}),
  onConfigChanged: vi.fn(() => () => {}),
  onCopyPendingCommentsRequest: vi.fn(() => () => {}),
  onFindInDiffs: vi.fn(() => () => {}),
  onKeyboardLayoutChanged: vi.fn(() => () => {}),
  onMarkdownDocumentChanged: vi.fn(() => () => {}),
  onOpenReviewSource: vi.fn(() => () => {}),
  onPlanCloseRequested: vi.fn(() => () => {}),
  onRefreshRequest: vi.fn(() => () => {}),
  onRepositoryChanged: vi.fn(() => () => {}),

  onWindowFullScreenChanged: vi.fn(() => () => {}),
  openConfigFile: vi.fn(async () => {}),
  openFile: vi.fn(async () => {}),

  openRepositoryFolder: vi.fn(async () => {}),
  resetCodeFontSize: vi.fn(async () => {}),
  resolvePullRequestUrl: vi.fn(async () => 'https://github.com/owner/repo/pull/1'),
  saveMarkdownDocument: vi.fn(async (request) => ({
    document: {
      content: request.content,
      id: `${request.kind}:${request.path}`,
      kind: request.kind,
      path: request.path,
      version: 'next-version',
    },
    status: 'saved' as const,
  })),
  savePlanReview: vi.fn(async (review) => review),
  saveRepositoryFile: vi.fn(async (request) => ({
    document: { ...request, version: 'next-version' },
    status: 'saved' as const,
  })),
  setDiffStyle: vi.fn(async () => {}),
  setShowOutdated: vi.fn(async () => {}),
  setWordWrap: vi.fn(async () => {}),
  sharePlan: vi.fn(async () => ({
    status: 'uploaded' as const,
    url: 'https://codiff.dev/p/test',
  })),

  showInFolder: vi.fn(async () => {}),
  submitPullRequestComment: vi.fn(async () => {
    throw new Error('Unexpected pull request comment submit.');
  }),
  submitPullRequestReview: vi.fn(async () => {}),

  ...overrides,
});

const dispatchModifiedKey = (key: string, shiftKey = false) => {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  window.dispatchEvent(
    new KeyboardEvent('keydown', { ctrlKey: !isMac, key, metaKey: isMac, shiftKey }),
  );
};

const renderAppForOpenFileShortcut = async (file: ChangedFile) => {
  const openFile = vi.fn(async () => {});

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [file],
    })),
    openFile,
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.codiff-file-header')).not.toBeNull();
  });

  return {
    container,
    openFile,
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

test('displays a diff while setup status and history are still pending', async () => {
  const getRepositoryHistory = vi.fn(
    () => new Promise<Awaited<ReturnType<Window['codiff']['getRepositoryHistory']>>>(() => {}),
  );
  window.codiff = createCodiffMock({
    getRepositoryHistory,
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [createChangedFile('src/app.ts')],
    })),
    getTerminalHelperStatus: vi.fn(() => new Promise<never>(() => {})),
  });
  await using view = await renderReact(<App />);
  await waitFor(() => {
    expect(view.container.querySelector('.codiff-file-header')).not.toBeNull();
    expect(view.container.querySelector('.loading')).toBeNull();
  });
  await waitFor(() => {
    expect(getRepositoryHistory).toHaveBeenCalledOnce();
  });
  await waitFor(() => expect(window.codiff.markWindowReady).toHaveBeenCalledOnce());
});

test('the first review layout uses the loaded preferences', async () => {
  const config = Promise.withResolvers<ReturnType<typeof createDefaultConfig>>();
  const nextConfig = createDefaultConfig();
  nextConfig.settings.sidebarPosition = 'right';
  window.codiff = createCodiffMock({ getConfig: vi.fn(() => config.promise) });
  await using view = await renderReact(<App />);
  expect(view.container.querySelector('.app-shell')).toBeNull();
  expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
  await act(async () => config.resolve(nextConfig));
  await waitFor(() => {
    expect(view.container.querySelector('.app-shell')?.getAttribute('data-sidebar-position')).toBe(
      'right',
    );
    expect(window.codiff.markWindowReady).toHaveBeenCalledOnce();
  });
});

test('unavailable preferences still reveal the review with defaults', async () => {
  window.codiff = createCodiffMock({
    getConfig: vi.fn(async () => {
      throw new Error('Unavailable');
    }),
  });
  await using view = await renderReact(<App />);
  await waitFor(() => {
    expect(view.container.querySelector('.app-shell')).not.toBeNull();
    expect(window.codiff.markWindowReady).toHaveBeenCalledOnce();
  });
});

test('a failed background history request does not hide the diff', async () => {
  const getRepositoryHistory = vi.fn(async () => {
    throw new Error('History is unavailable');
  });
  window.codiff = createCodiffMock({
    getRepositoryHistory,
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [createChangedFile('src/app.ts')],
    })),
  });
  await using view = await renderReact(<App />);
  await waitFor(() => expect(getRepositoryHistory).toHaveBeenCalledOnce());
  expect(view.container.querySelector('.codiff-file-header')).not.toBeNull();
  expect(view.container.textContent).not.toContain('History is unavailable');
});

test('code font preferences update root CSS variables', async () => {
  const nextConfig = createDefaultConfig();
  nextConfig.settings.codeFontFamily = 'JetBrains Mono';
  nextConfig.settings.codeFontSize = 14;
  window.codiff = createCodiffMock({
    getConfig: vi.fn(async () => nextConfig),
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    expect(document.documentElement.style.getPropertyValue('--font-diff-mono')).toBe(
      '"JetBrains Mono", monospace',
    );
    expect(document.documentElement.style.getPropertyValue('--font-diff-size')).toBe('14px');
    expect(document.documentElement.style.getPropertyValue('--font-diff-line-height')).toBe('22px');
  });

  await act(async () => root.unmount());
  container.remove();
});

test('desktop app places the sidebar on the configured side', async () => {
  const nextConfig = createDefaultConfig();
  nextConfig.settings.sidebarPosition = 'right';
  window.codiff = createCodiffMock({
    getConfig: vi.fn(async () => nextConfig),
  });

  await using app = await renderReact(<App />);

  await waitFor(() => {
    const shell = app.container.querySelector<HTMLElement>('.app-shell');
    expect(shell?.dataset.sidebarPosition).toBe('right');
    expect(shell?.style.gridTemplateColumns).toBe(
      'minmax(0, 1fr) 0 min(292px, 30vw) 0 min(252px, 30vw)',
    );
  });
});

test('empty code font family removes the root CSS variable', async () => {
  document.documentElement.style.setProperty('--font-diff-mono', 'stale');
  window.codiff = createCodiffMock();

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    expect(document.documentElement.style.getPropertyValue('--font-diff-mono')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--font-diff-size')).toBe('13px');
    expect(document.documentElement.style.getPropertyValue('--font-diff-line-height')).toBe('20px');
  });

  await act(async () => root.unmount());
  container.remove();
});

test('stale persisted collapsed sidebar state does not hide the sidebar on launch', async () => {
  window.localStorage.setItem('codiff:sidebar-collapsed', 'true');
  window.codiff = createCodiffMock();

  await using app = await renderReact(<App />);

  await waitFor(() => {
    expect(app.container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
      false,
    );
    expect(app.container.querySelector('.history-sidebar')).not.toBeNull();
    expect(app.container.querySelector('.files-sidebar')).not.toBeNull();
    expect(app.container.querySelectorAll('.sidebar-resizer')).toHaveLength(2);
    expect(app.container.querySelector('.review-top-bar [role="tablist"]')).toBeNull();
  });

  const topBar = app.container.querySelector('.review-top-bar');
  expect(app.container.querySelector('.sidebar [role="tablist"]')).toBeNull();
  const sidebarToggle = topBar?.querySelector<HTMLButtonElement>('.sidebar-toggle-button');
  await act(async () => sidebarToggle?.click());
  expect(app.container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
    true,
  );
  expect(app.container.querySelector('.review-top-bar')).toBe(topBar);
});

test('keeps source-loading errors in the open-source dialog', async () => {
  const openReviewSourceListeners: Array<Parameters<Window['codiff']['onOpenReviewSource']>[0]> =
    [];
  const getRepositoryState = vi.fn(async (source?: ReviewSource) => {
    if (source?.type === 'branch-working-tree') {
      throw new Error(`Branch "${source.ref}" does not exist in this repository.`);
    }
    return repositoryState;
  });
  window.codiff = createCodiffMock({
    getRepositoryState,
    onOpenReviewSource: vi.fn((callback) => {
      openReviewSourceListeners.push(callback);
      return () => {};
    }),
  });

  await using app = await renderReact(<App />);
  await waitFor(() => expect(app.container.querySelector('.app-shell')).not.toBeNull());

  await act(async () => openReviewSourceListeners[0]?.('branch'));
  const input = app.container.querySelector<HTMLInputElement>('#open-review-source-input');
  const form = app.container.querySelector('form.open-review-source-dialog');
  if (!input || !form) {
    throw new Error('Expected the open branch dialog.');
  }

  await setInputValue(input, 'missing-branch');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  await waitFor(() => {
    expect(app.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Branch "missing-branch" does not exist in this repository.',
    );
  });
  expect(app.container.querySelector('.open-review-source-dialog')).not.toBeNull();
  expect(app.container.querySelector('.app-shell')).not.toBeNull();
  expect(app.container.textContent).not.toContain('Unable to read repository');
});

test('top bar source menu opens the review source dialog', async () => {
  window.codiff = createCodiffMock();

  await using app = await renderReact(<App />);
  await waitFor(() => expect(app.container.querySelector('.app-shell')).not.toBeNull());

  const trigger = app.container.querySelector<HTMLButtonElement>(
    '.review-top-bar .open-review-source-trigger',
  );
  if (!trigger) {
    throw new Error('Expected the open review source trigger in the top bar.');
  }
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const pullRequestItem = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Open PR');
  if (!pullRequestItem) {
    throw new Error('Expected an Open PR menu item.');
  }
  await act(async () => {
    pullRequestItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const input = app.container.querySelector<HTMLInputElement>('#open-review-source-input');
  expect(input?.placeholder).toBe('#123 or https://github.com/owner/repo/pull/123');
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('repository label is plain text and clicking it does nothing', async () => {
  const openRepositoryFolder = vi.fn(async () => {});
  window.codiff = createCodiffMock({ openRepositoryFolder });

  await using app = await renderReact(<App />);
  await waitFor(() => expect(app.container.querySelector('.app-shell')).not.toBeNull());

  const label = app.container.querySelector<HTMLElement>('.review-top-bar-repository');
  if (!label) {
    throw new Error('Expected the repository label in the top bar.');
  }
  expect(label.tagName).toBe('SPAN');
  expect(label.textContent).toBe('/repo');
  expect(label.closest('.review-top-bar-repository-slot')?.getAttribute('title')).toBe('/repo');
  expect(app.container.querySelector('a.review-top-bar-repository')).toBeNull();
  expect(app.container.querySelector('button.review-top-bar-repository')).toBeNull();

  await act(async () => {
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(openRepositoryFolder).not.toHaveBeenCalled();
});

test('the branch name renders in the top bar context', async () => {
  window.codiff = createCodiffMock();

  await using app = await renderReact(<App />);
  await waitFor(() => expect(app.container.querySelector('.app-shell')).not.toBeNull());

  const branch = app.container.querySelector<HTMLElement>('.review-top-bar-branch');
  expect(branch?.textContent).toBe('main');
  expect(branch?.getAttribute('title')).toBe('main');
  expect(branch?.parentElement?.className).toBe('review-top-bar-context');
});

test('empty repository state fills the review pane for centered layout', async () => {
  window.codiff = createCodiffMock();

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    const emptyState = container.querySelector<HTMLElement>('.review > .empty-state');
    expect(emptyState?.textContent).toContain('No local changes');
  });
  const css = readFileSync(resolve('core/App.css'), 'utf8');
  const emptyStateRule = css.match(/\.review > \.empty-state \{([^}]*)\}/)?.[1];
  expect(emptyStateRule).toContain('flex: 1;');
  expect(emptyStateRule).toContain('min-width: 0;');
  expect(emptyStateRule).toContain('width: 100%;');

  await act(async () => root.unmount());
  container.remove();
});

test('showWhitespace config changes reload the current repository state', async () => {
  let configListener: ((config: ReturnType<typeof createDefaultConfig>) => void) | null = null;
  const nextConfig = createDefaultConfig();
  nextConfig.settings.showWhitespace = true;
  const initialState = {
    ...repositoryState,
    files: [createChangedFile('src/initial.ts')],
  };
  const reloadedState = {
    ...repositoryState,
    files: [createChangedFile('src/reloaded.ts')],
  };
  const getRepositoryState = vi
    .fn<Window['codiff']['getRepositoryState']>()
    .mockResolvedValueOnce(initialState)
    .mockResolvedValueOnce(reloadedState);
  window.codiff = createCodiffMock({
    getRepositoryState,
    onConfigChanged: vi.fn((callback) => {
      configListener = callback;
      return () => {};
    }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    expect(container.textContent).toContain('src/initial.ts');
  });

  await act(async () => {
    configListener?.(nextConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await waitFor(() => {
    expect(container.textContent).toContain('src/reloaded.ts');
  });
  expect(getRepositoryState).toHaveBeenLastCalledWith({ type: 'working-tree' });

  await act(async () => root.unmount());
  container.remove();
});

test('sidebar commit button toggles back to tree when commit view is open', async () => {
  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [createChangedFile('src/change.ts')],
    })),
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  await waitFor(() => {
    expect(container.querySelector('.sidebar-commit-button')?.textContent).toBe('Commit');
  });

  await act(async () => {
    container.querySelector<HTMLButtonElement>('.sidebar-commit-button')?.click();
  });

  await waitFor(() => {
    expect(container.querySelector('.wt-commit')).not.toBeNull();
    expect(container.querySelector('.sidebar-commit-button')?.textContent).toBe('Tree');
  });

  await act(async () => {
    container.querySelector<HTMLButtonElement>('.sidebar-commit-button')?.click();
  });

  await waitFor(() => {
    expect(container.querySelector('.wt-commit')).toBeNull();
    expect(container.querySelector('.sidebar-commit-button')?.textContent).toBe('Commit');
  });

  await act(async () => root.unmount());
  container.remove();
});

test('three columns keep Local accessible and update the file summary when switching commits', async () => {
  let resolveCommit: ((state: RepositoryState) => void) | undefined;
  const commitSource = { ref: 'aaa1111', type: 'commit' } satisfies ReviewSource;
  const emptySource = { ref: 'bbb2222', type: 'commit' } satisfies ReviewSource;
  const files = [
    createChangedFile('src/app.ts'),
    createChangedFile('tests/app.ts'),
    createChangedFile('README.md'),
  ];
  window.codiff = createCodiffMock({
    getRepositoryHistory: vi.fn(async () => ({
      entries: [
        {
          author: 'Reviewer',
          committedAt: Date.now(),
          parents: [],
          ref: commitSource.ref,
          subject: 'Update tests',
        },
        {
          author: 'Reviewer',
          committedAt: Date.now(),
          parents: [],
          ref: emptySource.ref,
          subject: 'Empty commit',
        },
      ],
      root: '/repo',
    })),
    getRepositoryState: vi.fn((source?: ReviewSource) => {
      if (source?.type === 'commit' && source.ref === commitSource.ref) {
        return new Promise<RepositoryState>((resolve) => {
          resolveCommit = resolve;
        });
      }
      return Promise.resolve({
        ...repositoryState,
        files: source?.type === 'commit' ? [] : files,
        source: source ?? repositoryState.source,
      });
    }),
  });
  await using app = await renderReact(<App />);
  const total = () => app.container.querySelector('.sidebar-total-line-count')?.textContent;
  await waitFor(() => expect(total()).toBe('+3-3'));
  await setInputValue(
    app.container.querySelector<HTMLInputElement>('.files-sidebar .sidebar-search')!,
    'README',
  );
  await waitFor(() => expect(total()).toBe('+1-1'));
  await setInputValue(
    app.container.querySelector<HTMLInputElement>('.history-sidebar .sidebar-search')!,
    'tests',
  );
  expect(total()).toBe('+1-1');
  expect(app.container.querySelector('.history-local .history-entry')).not.toBeNull();
  expect(app.container.querySelector('.files-sidebar file-tree-container')).not.toBeNull();
  await setInputValue(
    app.container.querySelector<HTMLInputElement>('.files-sidebar .sidebar-search')!,
    '',
  );
  expect(total()).toBe('+3-3');
  const breakdown = app.container.querySelector('.sidebar-summary-breakdown');
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>('.history-entry[title="Update tests"]')!.click(),
  );
  expect(total()).toBeUndefined();
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBe(breakdown);
  expect(app.container.querySelector('.sidebar-summary-footer[aria-busy="true"]')).not.toBeNull();
  await act(async () =>
    resolveCommit!({ ...repositoryState, files: [files[1]], source: commitSource }),
  );
  await waitFor(() => expect(total()).toBe('+1-1'));
  await waitFor(() => {
    const tree = app.container.querySelector('.files-sidebar file-tree-container')?.shadowRoot;
    expect(tree?.querySelector('[data-item-path="tests/app.ts"]')).not.toBeNull();
    expect(tree?.querySelector('[data-item-path="README.md"]')).toBeNull();
  });
  expect(
    [...app.container.querySelectorAll('.sidebar-summary-breakdown > div')].map(
      (row) => row.textContent,
    ),
  ).toEqual(['Prod+0-0', 'Tests+1-1', 'Other+0-0']);
  await setInputValue(
    app.container.querySelector<HTMLInputElement>('.history-sidebar .sidebar-search')!,
    '',
  );
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>('.history-entry[title="Empty commit"]')!.click(),
  );
  await waitFor(() =>
    expect(app.container.querySelector('.sidebar-total-empty')?.textContent).toBe('—'),
  );
  expect(app.container.querySelector('.sidebar-summary-footer')).not.toBeNull();
  await setInputValue(
    app.container.querySelector<HTMLInputElement>('.history-sidebar .sidebar-search')!,
    'no matches',
  );
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>('.history-local .history-entry')!.click(),
  );
  await waitFor(() => expect(total()).toBe('+3-3'));
  expect(
    app.container.querySelector('.history-local .history-entry')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(app.container.querySelector('.files-sidebar file-tree-container')).not.toBeNull();
});

test('repository reload restores the selected file when it still exists', async () => {
  const firstFile = createChangedFile('src/first.ts');
  const secondFile = createChangedFile('src/second.ts');
  const nextState = {
    ...repositoryState,
    files: [firstFile, secondFile],
  } satisfies RepositoryState;

  writeReloadSelection(nextState, secondFile.path);
  const openFile = vi.fn(async () => {});

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => nextState),
    openFile,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
      window.sessionStorage.clear();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.codiff-file-header')).not.toBeNull();
  });
  await act(async () => {
    dispatchModifiedKey('O', true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(openFile).toHaveBeenCalledWith(secondFile.path);
});

test('repository reload restores the selected file from the previous source', async () => {
  const firstFile = createChangedFile('src/first.ts');
  const secondFile = createChangedFile('src/second.ts');
  const source = { ref: 'abc1234', type: 'commit' } satisfies ReviewSource;
  const nextState = {
    ...repositoryState,
    files: [firstFile, secondFile],
    source,
  } satisfies RepositoryState;
  const getRepositoryState = vi.fn(async (requestedSource?: ReviewSource) =>
    requestedSource?.type === 'commit' ? nextState : repositoryState,
  );

  writeReloadSelection(nextState, secondFile.path);
  const openFile = vi.fn(async () => {});

  window.codiff = createCodiffMock({
    getRepositoryState,
    openFile,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.codiff-file-header')).not.toBeNull();
  });
  await act(async () => {
    dispatchModifiedKey('O', true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(openFile).toHaveBeenCalledWith(secondFile.path);
  expect(getRepositoryState).toHaveBeenCalledWith(source);
});

test('repository reload preserves a branch diff source even without a selected file', async () => {
  const source = {
    baseRef: 'base123',
    headRef: 'head123',
    ref: 'main',
    type: 'branch-diff',
  } satisfies ReviewSource;
  const nextState = {
    ...repositoryState,
    files: [],
    source,
  } satisfies RepositoryState;
  const getRepositoryState = vi.fn(async (requestedSource?: ReviewSource) =>
    requestedSource?.type === 'branch-diff' ? nextState : repositoryState,
  );

  writeReloadSelection(nextState, null);

  window.codiff = createCodiffMock({
    getRepositoryState,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
  });
  expect(getRepositoryState).toHaveBeenCalledWith(source);
});

test('branch history keeps branch diff available after selecting uncommitted changes', async () => {
  const branchSource = {
    baseRef: 'base123',
    headRef: 'head123',
    ref: 'main',
    type: 'branch-diff',
  } satisfies ReviewSource;
  const branchState = {
    ...repositoryState,
    branch: 'fork',
    source: branchSource,
  } satisfies RepositoryState;
  const workingTreeState = {
    ...repositoryState,
    branch: 'fork',
    source: { type: 'working-tree' },
  } satisfies RepositoryState;
  const getRepositoryState = vi.fn(async (requestedSource?: ReviewSource) =>
    requestedSource?.type === 'working-tree' ? workingTreeState : branchState,
  );

  window.codiff = createCodiffMock({
    getRepositoryHistory: vi.fn(async () => ({
      entries: [
        {
          author: 'Reviewer',
          committedAt: Date.now(),
          parents: [],
          ref: '99e7b27',
          subject: 'Add branch diff review mode',
        },
      ],
      root: '/repo',
    })),
    getRepositoryState,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  const findButton = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(findButton('Committed only vs main')).toBeTruthy();
    expect(findButton('All changes vs main')).toBeTruthy();
  });
  await act(async () => {
    findButton('Uncommitted')?.click();
  });
  await waitFor(() => {
    expect(getRepositoryState).toHaveBeenCalledWith({ type: 'working-tree' });
    expect(findButton('Committed only vs main')).toBeTruthy();
  });
  await act(async () => {
    findButton('Committed only vs main')?.click();
  });
  await waitFor(() => {
    expect(getRepositoryState).toHaveBeenCalledWith(branchSource);
  });
});

test('repository reload restores branch diff scope after selecting uncommitted changes', async () => {
  const branchSource = {
    baseRef: 'base123',
    headRef: 'head123',
    ref: 'main',
    type: 'branch-diff',
  } satisfies ReviewSource;
  const workingTreeState = {
    ...repositoryState,
    branch: 'fork',
    source: { type: 'working-tree' },
  } satisfies RepositoryState;
  const getRepositoryHistory = vi.fn(async () => ({
    entries: [
      {
        author: 'Reviewer',
        committedAt: Date.now(),
        parents: [],
        ref: '99e7b27',
        subject: 'Add branch diff review mode',
      },
    ],
    root: '/repo',
  }));
  const getRepositoryState = vi.fn(async () => workingTreeState);

  writeReloadSelection(workingTreeState, null, branchSource);

  window.codiff = createCodiffMock({
    getRepositoryHistory,
    getRepositoryState,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  const findButton = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(findButton('Committed only vs main')).toBeTruthy();
  });
  expect(getRepositoryState).toHaveBeenCalledWith({ type: 'working-tree' });
  expect(getRepositoryHistory).toHaveBeenCalledWith(expect.any(Number), branchSource);
});

test('repository reload does not let stale selection override launch source', async () => {
  const launchSource = {
    ref: 'main',
    type: 'branch-working-tree',
  } satisfies ReviewSource;
  const staleState = {
    ...repositoryState,
    source: { type: 'working-tree' },
  } satisfies RepositoryState;
  const branchState = {
    ...repositoryState,
    source: launchSource,
  } satisfies RepositoryState;
  const getRepositoryState = vi.fn(async (requestedSource?: ReviewSource) =>
    requestedSource?.type === 'working-tree' ? staleState : branchState,
  );

  writeReloadSelection(staleState, null);

  window.codiff = createCodiffMock({
    getLaunchOptions: vi.fn(async () => ({
      repositoryPathProvided: true,
      source: launchSource,
    })),
    getRepositoryState,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
  });
  expect(getRepositoryState).toHaveBeenCalledWith(undefined);
  expect(getRepositoryState).not.toHaveBeenCalledWith(staleState.source);
});

test('repository reload colors only git status glyphs for files changed after reload', async () => {
  const unchangedFile = createChangedFile('src/unchanged.ts', {
    fingerprint: 'same',
  });
  const changedFileBeforeReload = createChangedFile('src/changed.ts', {
    fingerprint: 'before',
  });
  const changedFileAfterReload = createChangedFile('src/changed.ts', {
    fingerprint: 'after',
  });
  const previousState = {
    ...repositoryState,
    files: [unchangedFile, changedFileBeforeReload],
  } satisfies RepositoryState;
  const nextState = {
    ...repositoryState,
    files: [unchangedFile, changedFileAfterReload],
  } satisfies RepositoryState;

  writeReloadSelection(previousState, changedFileBeforeReload.path);

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => nextState),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    const shadowRoot = container.querySelector('file-tree-container')?.shadowRoot;
    const styleText =
      shadowRoot?.querySelector('style[data-codiff-reload-delta-git-status]')?.textContent ?? '';
    expect(styleText).toContain('[data-item-path="src/changed.ts"][data-item-git-status]');
    expect(styleText).not.toContain('[data-item-path="src/unchanged.ts"][data-item-git-status]');
    expect(styleText).toContain("> [data-item-section='git']");
    expect(
      shadowRoot?.querySelector(
        '[data-item-path="src/changed.ts"][data-item-git-status] > [data-item-section="git"]',
      ),
    ).toBeTruthy();
    expect(
      shadowRoot?.querySelector(
        '[data-item-path="src/unchanged.ts"][data-item-git-status] > [data-item-section="git"]',
      ),
    ).toBeTruthy();
  });
});

test('tree sidebar subtly mutes files currently marked viewed', async () => {
  const viewedFile = createChangedFile('src/viewed.ts', {
    fingerprint: 'viewed-current',
  });
  const staleViewedFile = createChangedFile('src/stale.ts', {
    fingerprint: 'stale-current',
  });
  const nextState = {
    ...repositoryState,
    files: [viewedFile, staleViewedFile],
  } satisfies RepositoryState;

  window.localStorage.setItem(
    'codiff:viewed:/repo',
    JSON.stringify({
      [staleViewedFile.path]: 'stale-previous',
      [viewedFile.path]: viewedFile.fingerprint,
    }),
  );
  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => nextState),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    const shadowRoot = container.querySelector('file-tree-container')?.shadowRoot;
    const styleText =
      shadowRoot?.querySelector('style[data-codiff-viewed-rows]')?.textContent ?? '';
    expect(styleText).toContain('[data-item-path="src/viewed.ts"]');
    expect(styleText).not.toContain('[data-item-path="src/stale.ts"]');
    expect(styleText).not.toContain('color-mix(in srgb, var(--viewed)');
    expect(styleText).toContain(
      "[data-item-path=\"src/viewed.ts\"] > [data-item-section='icon'] > :where(:not([data-icon-name='file-tree-icon-chevron']))",
    );
    expect(styleText).toContain("> [data-item-section='content']");
    expect(styleText).toContain('color: var(--muted)');
  });
});

test('before unload saves the current source and selected file for any reload trigger', async () => {
  const changedFile = createChangedFile('src/app.ts');
  const source = { ref: 'abc1234', type: 'commit' } satisfies ReviewSource;
  const nextState = {
    ...repositoryState,
    files: [changedFile],
    source,
  } satisfies RepositoryState;

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => nextState),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
  });
  window.dispatchEvent(new Event('beforeunload'));
  const selection = consumeReloadSelection();
  expect(selection?.source).toEqual(source);
  expect(getReloadSelectionPath(selection, nextState)).toBe(changedFile.path);
});

test('Mod+K opens the command bar', async () => {
  const changedFile = createChangedFile('src/app.ts');
  await using app = await renderAppForOpenFileShortcut(changedFile);

  await act(async () => {
    dispatchModifiedKey('k');
  });

  expect(app.container.querySelector('.command-bar-input')).not.toBeNull();
  expect(app.container.querySelector('.app-shell')?.classList.contains('command-bar-open')).toBe(
    true,
  );
  expect(app.openFile).not.toHaveBeenCalled();
});

test('Mod+Shift+O opens the selected file in the editor', async () => {
  const changedFile = createChangedFile('src/app.ts');
  await using app = await renderAppForOpenFileShortcut(changedFile);

  await act(async () => {
    dispatchModifiedKey('O', true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.openFile).toHaveBeenCalledWith(changedFile.path);
});

test('Mod+Shift+O does not open deleted files', async () => {
  const deletedFile = {
    ...createChangedFile('src/removed.ts'),
    status: 'deleted',
  } satisfies ChangedFile;
  await using app = await renderAppForOpenFileShortcut(deletedFile);

  await act(async () => {
    dispatchModifiedKey('O', true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.openFile).not.toHaveBeenCalled();
});

test('commit messages use the shared source description presentation', async () => {
  const changedFile = createChangedFile('src/app.ts');
  const source = { ref: 'abc1234', type: 'commit' } satisfies ReviewSource;
  const commitMetadata = createCommitMetadataFixture('## Details\n\nDetailed **commit** body.');
  const historyAvatarUrl = 'https://avatars.githubusercontent.com/u/1?v=4';

  window.codiff = createCodiffMock({
    getRepositoryHistory: vi.fn(async () => ({
      entries: [
        {
          author: commitMetadata.author.name,
          committedAt: Date.parse(commitMetadata.author.date),
          gravatarUrl: historyAvatarUrl,
          parents: commitMetadata.parents,
          ref: commitMetadata.ref,
          subject: commitMetadata.subject,
        },
      ],
      root: '/repo',
    })),
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      commitMetadata,
      files: [changedFile],
      source,
    })),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.codiff-source-description-header')).not.toBeNull();
  });
  await waitFor(() => {
    expect(container.querySelector('.source-description-markdown')?.textContent).toContain(
      'Detailed commit body.',
    );
  });
  const header = container.querySelector<HTMLElement>('.codiff-source-description-header');
  expect(header?.querySelector('.source-description-title')?.textContent).toBe(
    commitMetadata.subject,
  );
  expect(container.querySelector('.source-description-author-header')?.textContent).toContain(
    commitMetadata.author.name,
  );
  expect(
    container.querySelector<HTMLImageElement>('.source-description-comment > .avatar.medium')?.src,
  ).toBe(historyAvatarUrl);
  expect(container.querySelector('[aria-label="Preview commit message"]')).not.toBeNull();
  expect(container.querySelector('.codiff-commit-details-header')).toBeNull();
  expect(container.querySelector('.commit-details-panel')).toBeNull();
  expect(container.textContent).not.toContain('Verified signature');
  expect(container.textContent).not.toContain('Co-authored-by');
});

test('bodyless commits still render the author and profile image', async () => {
  const commitMetadata = createCommitMetadataFixture('');
  const source = {
    ref: commitMetadata.ref,
    type: 'commit',
  } satisfies ReviewSource;

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      commitMetadata,
      files: [createChangedFile('src/app.ts')],
      source,
    })),
  });

  await using app = await renderReact(<App />);

  await waitFor(() => {
    expect(app.container.querySelector('.source-description-author-header')?.textContent).toContain(
      commitMetadata.author.name,
    );
  });
  expect(
    app.container.querySelector<HTMLImageElement>('.source-description-comment > .avatar.medium')
      ?.src,
  ).toBe(commitMetadata.author.gravatarUrl);
  expect(
    app.container.querySelector('.source-description-author-header.without-description'),
  ).not.toBeNull();
  expect(app.container.querySelector('.source-description-markdown')).toBeNull();
  expect(
    app.container
      .querySelector('.codiff-source-description-header')
      ?.querySelector('.source-description-title')?.textContent,
  ).toBe(commitMetadata.subject);
});

test('pull request descriptions render as provider-aware Markdown source context', async () => {
  const changedFile = createChangedFile('src/app.ts');
  const cases: ReadonlyArray<{
    label: string;
    source: Extract<ReviewSource, { type: 'pull-request' }>;
  }> = [
    {
      label: 'PR description',
      source: {
        author: {
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          login: 'octocat',
          url: 'https://github.com/octocat',
        },
        description: '## Intent\n\nShip **review** context.',
        number: 12,
        provider: 'github',
        type: 'pull-request',
        url: 'https://github.com/nkzw-tech/codiff/pull/12',
      },
    },
    {
      label: 'MR description',
      source: {
        description: '## Intent\n\nShip **review** context.',
        number: 13,
        provider: 'gitlab',
        type: 'pull-request',
        url: 'https://gitlab.example.com/group/project/-/merge_requests/13',
      },
    },
    {
      label: 'Description',
      source: {
        description: '## Intent\n\nShip **review** context.',
        number: 14,
        type: 'pull-request',
        url: 'https://example.com/reviews/14',
      },
    },
  ];

  for (const { label, source } of cases) {
    window.codiff = createCodiffMock({
      getRepositoryState: vi.fn(async () => ({
        ...repositoryState,
        files: [changedFile],
        source,
      })),
    });
    await using app = await renderReact(<App />);

    await waitFor(() => {
      expect(app.container.querySelector('.codiff-source-description-header')).not.toBeNull();
    });
    const header = app.container.querySelector<HTMLElement>('.codiff-source-description-header');
    const body = app.container.querySelector<HTMLElement>('.source-description-markdown');
    expect(body?.textContent).toContain('Intent');
    expect(body?.textContent).toContain('Ship review context.');
    expect(header?.querySelector('.codiff-file-path')?.textContent).toBe(label);
    expect(header?.querySelector('.source-description-title')).toBeNull();
    if (source.author) {
      expect(header?.querySelector('.source-description-author')).toBeNull();
      expect(
        app.container.querySelector('.source-description-author-header')?.textContent,
      ).toContain(source.author.name ?? `@${source.author.login}`);
    } else {
      expect(header?.querySelector('.source-description-author')).toBeNull();
    }
    const toggle = header?.querySelector<HTMLButtonElement>('button.codiff-header-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.type).toBe('button');
  }
});

test('pull request description collapse button toggles the markdown body', async () => {
  const source = {
    description: '## Intent\n\nShip **review** context.',
    number: 12,
    provider: 'github',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  } satisfies ReviewSource;

  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [createChangedFile('src/app.ts')],
      source,
    })),
  });

  await using app = await renderReact(<App />);

  await waitFor(() => {
    expect(app.container.querySelector('.source-description-markdown')).not.toBeNull();
  });
  const repositoryLabel = app.container.querySelector<HTMLElement>('.review-top-bar-repository');
  const sourceLink = app.container.querySelector<HTMLAnchorElement>('.review-top-bar-source');
  expect(repositoryLabel).not.toBeNull();
  expect(sourceLink?.href).toBe(source.url);
  expect(sourceLink?.textContent).toBe('PR #12');
  expect(sourceLink?.querySelector('svg')).not.toBeNull();
  let toggle = app.container.querySelector<HTMLButtonElement>('button.codiff-header-toggle');
  expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  expect(app.container.querySelector('.source-description-markdown')?.textContent).toContain(
    'Ship review context.',
  );
  await act(async () => {
    toggle?.click();
  });
  await waitFor(() => {
    toggle = app.container.querySelector<HTMLButtonElement>('button.codiff-header-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(app.container.querySelector('.source-description-markdown')).toBeNull();
  });
  await act(async () => {
    toggle?.click();
  });
  await waitFor(() => {
    expect(
      app.container
        .querySelector<HTMLButtonElement>('button.codiff-header-toggle')
        ?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(app.container.querySelector('.source-description-markdown')?.textContent).toContain(
      'Ship review context.',
    );
  });
});

test('missing pull request descriptions do not render placeholder source context', async () => {
  window.codiff = createCodiffMock({
    getRepositoryState: vi.fn(async () => ({
      ...repositoryState,
      files: [createChangedFile('src/app.ts')],
      source: {
        description: '   ',
        number: 12,
        provider: 'github',
        type: 'pull-request',
        url: 'https://github.com/nkzw-tech/codiff/pull/12',
      } satisfies ReviewSource,
    })),
  });

  await using app = await renderReact(<App />);

  await waitFor(() => {
    expect(app.container.querySelector('.codiff-file-header')).not.toBeNull();
  });
  expect(app.container.querySelector('.codiff-source-description-header')).toBeNull();
  expect(app.container.textContent).not.toContain('PR description');
});

test('title-only pull request source context renders as a collapsed static header', async () => {
  const cases: ReadonlyArray<Extract<ReviewSource, { type: 'pull-request' }>> = [
    {
      description: '   ',
      number: 12,
      provider: 'github',
      title: 'Title without a body',
      type: 'pull-request',
      url: 'https://github.com/nkzw-tech/codiff/pull/12',
    },
    {
      number: 13,
      provider: 'gitlab',
      title: 'Merge request title only',
      type: 'pull-request',
      url: 'https://gitlab.example.com/group/project/-/merge_requests/13',
    },
  ];

  for (const source of cases) {
    window.codiff = createCodiffMock({
      getRepositoryState: vi.fn(async () => ({
        ...repositoryState,
        files: [createChangedFile('src/app.ts')],
        source,
      })),
    });
    await using app = await renderReact(<App />);

    await waitFor(() => {
      expect(app.container.querySelector('.codiff-source-description-header')).not.toBeNull();
    });
    const header = app.container.querySelector<HTMLElement>('.codiff-source-description-header');
    expect(header?.classList.contains('collapsed')).toBe(true);
    expect(header?.querySelector('.source-description-title')?.textContent).toBe(source.title);
    expect(header?.querySelector('.codiff-header-toggle-static')).not.toBeNull();
    expect(header?.querySelector('button.codiff-header-toggle')).toBeNull();
    expect(header?.querySelector('.codiff-chevron-box')).toBeNull();
    expect(app.container.querySelector('.source-description-markdown')).toBeNull();
  }
});

test('plan mode opens the Markdown editor without loading repository state', async () => {
  const getRepositoryState = vi.fn(async () => repositoryState);
  const completePlan = vi.fn(async (_review: PlanReview, _status: 'closed' | 'done') => {});
  const markPlanReady = vi.fn(async () => {});
  const sharePlan = vi.fn(async (_review: PlanReview) => ({
    status: 'uploaded' as const,
    url: 'https://codiff.dev/p/shared-plan',
  }));
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  const storedReview = {
    document: {
      id: 'stale-plan-id',
      path: '/tmp/old-plan.md',
      version: 'stale-version',
    },
    threads: [
      {
        anchor: {
          block: {
            fingerprint: 'heading-fingerprint',
            path: [1],
            text: 'Execute this plan',
            type: 'heading',
          },
          kind: 'block',
          version: 1,
        },
        createdAt: '2026-06-24T00:00:00.000Z',
        createdBy: {
          email: 'reviewer@example.com',
          id: 'reviewer@example.com',
          name: 'Reviewer',
        },
        id: 'thread-1',
        messages: [
          {
            author: {
              email: 'reviewer@example.com',
              id: 'reviewer@example.com',
              name: 'Reviewer',
            },
            body: 'Keep the rollout steps explicit.',
            createdAt: '2026-06-24T00:00:00.000Z',
            id: 'message-1',
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        ],
        status: 'open',
        updatedAt: '2026-06-24T00:00:00.000Z',
      },
      {
        anchor: {
          block: {
            fingerprint: 'list-item-fingerprint',
            path: [2, 0],
            text: 'First',
            type: 'listitem',
          },
          kind: 'block',
          version: 1,
        },
        createdAt: '2026-06-24T00:01:00.000Z',
        createdBy: {
          email: 'reviewer@example.com',
          id: 'reviewer@example.com',
          name: 'Reviewer',
        },
        id: 'empty-thread',
        messages: [
          {
            author: {
              email: 'reviewer@example.com',
              id: 'reviewer@example.com',
              name: 'Reviewer',
            },
            body: '   ',
            createdAt: '2026-06-24T00:01:00.000Z',
            id: 'empty-message',
            updatedAt: '2026-06-24T00:01:00.000Z',
          },
        ],
        status: 'open',
        updatedAt: '2026-06-24T00:01:00.000Z',
      },
    ],
    version: 1,
  } satisfies PlanReview;
  window.codiff = createCodiffMock({
    completePlan,
    getFeatureFlags: vi.fn(async () => ({
      planSharing: true,
    })),
    getGitIdentity: vi.fn(async () => ({
      email: 'current-user@example.com',
      gravatarUrl: 'https://example.com/current-user.png',
      name: 'Current User',
    })),
    getLaunchOptions: vi.fn(async () => ({
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    })),
    getMarkdownDocument: vi.fn(async () => ({
      content:
        '---\ntitle: Execute this plan\ndraft: true\n---\n\n# Execute this plan\n\n- First\n- Second\n\n```sh\nvp test\n```\n',
      id: 'plan:/tmp/plan.md',
      kind: 'plan' as const,
      path: '/tmp/plan.md',
      version: 'plan-version',
    })),
    getPlanReview: vi.fn(async () => storedReview),
    getRepositoryState,
    markPlanReady,
    sharePlan,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.plan-shell')).not.toBeNull();
  });
  expect(getRepositoryState).not.toHaveBeenCalled();
  expect(markPlanReady).toHaveBeenCalledTimes(1);
  expect(container.querySelector('.plan-title')?.textContent).toContain('plan.md');
  await waitFor(() => {
    expect(container.querySelector('[data-editor-type="frontmatter"]')).not.toBeNull();
  });
  expect(container.querySelector('.mdx-editor-content h2')).toBeNull();
  expect(container.querySelectorAll('.mdx-editor-content ul > li')).toHaveLength(2);
  await waitFor(() => {
    expect(container.querySelector('.cm-content')).not.toBeNull();
  });
  expect(container.querySelector('.cm-gutters')).toBeNull();
  expect(container.querySelector('.cm-content')?.textContent).toContain('vp test');
  await waitFor(() => {
    expect(container.querySelector('.plan-comment-thread')?.textContent).toContain(
      'Keep the rollout steps explicit.',
    );
  });
  const planCommentAvatar = container.querySelector('.plan-comment-thread .avatar.medium');
  expect(planCommentAvatar?.tagName).toBe('SPAN');
  expect(planCommentAvatar?.textContent).toBe('RE');
  const commentTargetButton = container.querySelector<HTMLButtonElement>('.plan-comment-target');
  expect(commentTargetButton?.textContent).toBe('Heading · Execute this plan');
  expect(commentTargetButton?.disabled).toBe(false);
  await act(async () => {
    commentTargetButton?.click();
  });
  expect(scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'center',
  });
  scrollIntoView.mockClear();
  expect(container.querySelector('[data-mdx-annotation-block~="thread-1"]')).not.toBeNull();
  expect(container.querySelectorAll('li[data-mdx-comment-block-type="listitem"]')).toHaveLength(2);
  const planWorkspace = container.querySelector<HTMLElement>('.plan-workspace');
  const editorContent = container.querySelector<HTMLElement>('.mdx-editor-content');
  const commentBlock = container.querySelectorAll<HTMLElement>(
    'li[data-mdx-comment-block-type="listitem"]',
  )[1];
  expect(planWorkspace).not.toBeNull();
  expect(editorContent).not.toBeNull();
  expect(commentBlock).toBeDefined();
  planWorkspace!.getBoundingClientRect = () => ({
    bottom: 700,
    height: 650,
    left: 100,
    right: 1100,
    toJSON: () => {},
    top: 50,
    width: 1000,
    x: 100,
    y: 50,
  });
  editorContent!.style.paddingRight = '24px';
  editorContent!.getBoundingClientRect = () => ({
    bottom: 650,
    height: 550,
    left: 120,
    right: 1020,
    toJSON: () => {},
    top: 100,
    width: 900,
    x: 120,
    y: 100,
  });
  commentBlock!.getBoundingClientRect = () => ({
    bottom: 224,
    height: 24,
    left: 144,
    right: 996,
    toJSON: () => {},
    top: 200,
    width: 852,
    x: 144,
    y: 200,
  });
  await act(async () => {
    commentBlock!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  });
  await waitFor(() => {
    expect(container.querySelector('.plan-comment-affordance')).not.toBeNull();
  });
  const commentAffordance = container.querySelector<HTMLElement>('.plan-comment-affordance')!;
  expect(commentAffordance.dataset.mdxCommentButton).toBe('');
  expect(commentAffordance.style.getPropertyValue('--plan-comment-left')).toBe('896px');
  expect(commentAffordance.style.getPropertyValue('--plan-comment-width')).toBe('48px');
  expect(commentAffordance.querySelector(':scope > .plan-comment-add')).not.toBeNull();
  await act(async () => {
    editorContent!.dispatchEvent(
      new MouseEvent('pointerleave', { relatedTarget: commentAffordance }),
    );
  });
  expect(container.querySelector('.plan-comment-affordance')).not.toBeNull();
  await act(async () => {
    commentAffordance.dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: editorContent,
      }),
    );
  });
  expect(container.querySelector('.plan-comment-affordance')).not.toBeNull();
  await act(async () => {
    commentAffordance.dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: planWorkspace,
      }),
    );
  });
  expect(container.querySelector('.plan-comment-affordance')).toBeNull();
  await act(async () => {
    container
      .querySelectorAll<HTMLElement>('li[data-mdx-comment-block-type="listitem"]')[0]!
      .dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    commentBlock!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  });
  const addCommentButton = container.querySelector<HTMLButtonElement>('.plan-comment-add');
  expect(addCommentButton).not.toBeNull();
  await act(async () => {
    addCommentButton!.click();
  });
  const activeComment = container.querySelector<HTMLElement>('.plan-comment-thread.active');
  expect(activeComment).not.toBeNull();
  expect(activeComment!.closest<HTMLElement>('.plan-comment-position')?.style.top).not.toBe('0px');
  const activeCommentDelete =
    activeComment!.querySelector<HTMLButtonElement>('.review-comment-delete');
  expect(activeCommentDelete).not.toBeNull();
  await act(async () => {
    activeCommentDelete!.click();
  });
  const commentRail = container.querySelector<HTMLElement>('.plan-comment-rail-scroll');
  const commentPosition = container.querySelector<HTMLElement>('.plan-comment-position');
  const annotatedBlock = container.querySelector<HTMLElement>(
    '[data-mdx-annotation-block~="thread-1"]',
  );
  expect(commentRail).not.toBeNull();
  expect(commentPosition).not.toBeNull();
  expect(annotatedBlock).not.toBeNull();
  commentRail!.style.overflowY = 'auto';
  commentRail!.getBoundingClientRect = () => ({
    bottom: 300,
    height: 200,
    left: 0,
    right: 400,
    toJSON: () => {},
    top: 100,
    width: 400,
    x: 0,
    y: 100,
  });
  commentPosition!.getBoundingClientRect = () => ({
    bottom: 360,
    height: 100,
    left: 0,
    right: 400,
    toJSON: () => {},
    top: 260,
    width: 400,
    x: 0,
    y: 260,
  });
  const scrollCommentRail = vi.fn();
  commentRail!.scrollTo = scrollCommentRail;
  await act(async () => {
    annotatedBlock!.click();
  });
  await waitFor(() => {
    expect(scrollCommentRail).toHaveBeenCalledWith({
      behavior: 'smooth',
      top: 68,
    });
  });
  expect(scrollIntoView).not.toHaveBeenCalled();
  const deleteButtons = container.querySelectorAll<HTMLButtonElement>('.review-comment-delete');
  expect(deleteButtons).toHaveLength(2);
  await act(async () => {
    deleteButtons[1]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    deleteButtons[1]!.click();
  });
  expect(scrollIntoView).not.toHaveBeenCalled();
  const shareButton = container.querySelector<HTMLButtonElement>('.plan-share-button');
  expect(shareButton?.textContent).toContain('Share');
  await act(async () => {
    shareButton?.click();
  });
  await waitFor(() => {
    expect(sharePlan).toHaveBeenCalledTimes(1);
  });
  expect(sharePlan.mock.calls[0]?.[0].threads).toHaveLength(1);
  expect(shareButton?.textContent).toContain('Copied');
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.plan-done-button')?.click();
  });
  await waitFor(() => {
    expect(completePlan).toHaveBeenCalledTimes(1);
  });
  expect(completePlan).toHaveBeenCalledWith(
    expect.objectContaining({
      document: {
        id: 'plan:/tmp/plan.md',
        path: '/tmp/plan.md',
        version: 'plan-version',
      },
      threads: [
        expect.objectContaining({
          id: 'thread-1',
          messages: [
            expect.objectContaining({
              body: 'Keep the rollout steps explicit.',
            }),
          ],
        }),
      ],
      version: 1,
    }),
    'done',
  );
  expect(completePlan.mock.calls[0]?.[0].threads).toHaveLength(1);
});

test('plan mode resolves stored comments whose anchors were already removed', async () => {
  const savePlanReview = vi.fn(async (review: PlanReview) => review);
  const storedReview = {
    document: {
      id: 'plan:/tmp/plan.md',
      path: '/tmp/plan.md',
      version: 'old-plan-version',
    },
    threads: [
      {
        anchor: {
          block: {
            fingerprint: 'removed-heading-fingerprint',
            path: [99],
            text: 'Removed heading',
            type: 'heading',
          },
          kind: 'block',
          version: 1,
        },
        createdAt: '2026-06-24T00:00:00.000Z',
        createdBy: {
          email: 'reviewer@example.com',
          id: 'reviewer@example.com',
          name: 'Reviewer',
        },
        id: 'detached-thread',
        messages: [
          {
            author: {
              email: 'reviewer@example.com',
              id: 'reviewer@example.com',
              name: 'Reviewer',
            },
            body: 'Keep this comment as history.',
            createdAt: '2026-06-24T00:00:00.000Z',
            id: 'detached-message',
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        ],
        status: 'open',
        updatedAt: '2026-06-24T00:00:00.000Z',
      },
    ],
    version: 1,
  } satisfies PlanReview;
  window.codiff = createCodiffMock({
    getLaunchOptions: vi.fn(async () => ({
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    })),
    getMarkdownDocument: vi.fn(async () => ({
      content: '# Current plan\n',
      id: 'plan:/tmp/plan.md',
      kind: 'plan' as const,
      path: '/tmp/plan.md',
      version: 'plan-version',
    })),
    getPlanReview: vi.fn(async () => storedReview),
    savePlanReview,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await using _resource = {
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
  await act(async () => {
    root.render(<App />);
  });
  await waitFor(() => {
    expect(savePlanReview).toHaveBeenCalledWith(
      expect.objectContaining({
        threads: [
          expect.objectContaining({
            id: 'detached-thread',
            resolution: expect.objectContaining({
              reason: 'anchor-removed',
              resolvedAt: expect.any(String),
            }),
            status: 'resolved',
          }),
        ],
      }),
    );
  });
  const resolvedSection = container.querySelector<HTMLDetailsElement>('.plan-resolved-comments');
  expect(resolvedSection?.open).toBe(false);
  expect(resolvedSection?.querySelector('summary')?.textContent).toBe('Resolved comments (1)');
  expect(container.querySelector('.plan-comment-thread.resolved')?.textContent).toContain(
    'Resolved after target removal',
  );
  expect(container.querySelector('[data-mdx-annotation-block~="detached-thread"]')).toBeNull();
  await act(async () => {
    resolvedSection!.open = true;
    resolvedSection!.dispatchEvent(new Event('toggle'));
  });
  await act(async () => {
    resolvedSection?.querySelector<HTMLButtonElement>('.review-comment-delete')?.click();
  });
  await waitFor(() => {
    expect(container.querySelector('.plan-resolved-comments')).toBeNull();
    expect(savePlanReview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threads: [],
      }),
    );
  });
});

test('plan mode keeps comments open when their anchors are removed during the current review', async () => {
  let publishMarkdownChange:
    | ((change: {
        deleted: boolean;
        document: {
          content: string;
          id: string;
          kind: 'plan';
          path: string;
          version: string;
        };
        id: string;
      }) => void)
    | null = null;
  const savePlanReview = vi.fn(async (review: PlanReview) => review);
  const storedReview = {
    document: {
      id: 'plan:/tmp/plan.md',
      path: '/tmp/plan.md',
      version: 'plan-version',
    },
    threads: [
      {
        anchor: {
          block: {
            fingerprint: 'heading-fingerprint',
            path: [0],
            text: 'Current plan',
            type: 'heading',
          },
          kind: 'block',
          version: 1,
        },
        createdAt: '2026-06-24T00:00:00.000Z',
        createdBy: {
          email: 'reviewer@example.com',
          id: 'reviewer@example.com',
          name: 'Reviewer',
        },
        id: 'live-thread',
        messages: [
          {
            author: {
              email: 'reviewer@example.com',
              id: 'reviewer@example.com',
              name: 'Reviewer',
            },
            body: 'The agent still needs to process this.',
            createdAt: '2026-06-24T00:00:00.000Z',
            id: 'live-message',
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        ],
        status: 'open',
        updatedAt: '2026-06-24T00:00:00.000Z',
      },
    ],
    version: 1,
  } satisfies PlanReview;
  window.codiff = createCodiffMock({
    getLaunchOptions: vi.fn(async () => ({
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    })),
    getMarkdownDocument: vi.fn(async () => ({
      content: '# Current plan\n',
      id: 'plan:/tmp/plan.md',
      kind: 'plan' as const,
      path: '/tmp/plan.md',
      version: 'plan-version',
    })),
    getPlanReview: vi.fn(async () => storedReview),
    onMarkdownDocumentChanged: vi.fn((callback) => {
      publishMarkdownChange = callback;
      return () => {
        publishMarkdownChange = null;
      };
    }),
    savePlanReview,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await using _resource = {
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
  await act(async () => {
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('[data-mdx-annotation-block~="live-thread"]')).not.toBeNull();
    expect(publishMarkdownChange).not.toBeNull();
  });
  savePlanReview.mockClear();
  await act(async () => {
    publishMarkdownChange?.({
      deleted: false,
      document: {
        content: '# Replacement plan\n',
        id: 'plan:/tmp/plan.md',
        kind: 'plan',
        path: '/tmp/plan.md',
        version: 'next-plan-version',
      },
      id: 'plan:/tmp/plan.md',
    });
  });
  await waitFor(() => {
    expect(container.querySelector('[data-mdx-annotation-block~="live-thread"]')).toBeNull();
  });
  expect(container.querySelector('.plan-resolved-comments')).toBeNull();
  expect(container.querySelector('.plan-comment-position .plan-comment-thread')).not.toBeNull();
  expect(
    savePlanReview.mock.calls.some(
      ([review]) =>
        review.threads.find((thread) => thread.id === 'live-thread')?.status === 'resolved',
    ),
  ).toBe(false);
});

test('closing plan mode flushes and returns a closed handoff', async () => {
  const completePlan = vi.fn(async (_review: PlanReview, _status: 'closed' | 'done') => {});
  let blockPlanReviewSave = false;
  let resolvePlanReviewSave: (() => void) | null = null;
  const savePlanReview = vi.fn((review: PlanReview) => {
    if (!blockPlanReviewSave) {
      return Promise.resolve(review);
    }
    return new Promise<PlanReview>((resolveSave) => {
      resolvePlanReviewSave = () => resolveSave(review);
    });
  });
  let requestClose: (() => void) | null = null;
  window.codiff = createCodiffMock({
    completePlan,
    getLaunchOptions: vi.fn(async () => ({
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    })),
    getMarkdownDocument: vi.fn(async () => ({
      content: '# Execute this plan\n',
      id: 'plan:/tmp/plan.md',
      kind: 'plan' as const,
      path: '/tmp/plan.md',
      version: 'plan-version',
    })),
    getPlanReview: vi.fn(async (): Promise<PlanReview> => ({
      document: {
        id: 'plan:/tmp/plan.md',
        path: '/tmp/plan.md',
        version: 'plan-version',
      },
      threads: [
        {
          anchor: {
            block: {
              fingerprint: 'heading-fingerprint',
              path: [0],
              text: 'Execute this plan',
              type: 'heading',
            },
            kind: 'block',
            version: 1,
          },
          createdAt: '2026-06-24T00:00:00.000Z',
          createdBy: {
            email: 'reviewer@example.com',
            id: 'reviewer@example.com',
            name: 'Reviewer',
          },
          id: 'thread-1',
          messages: [
            {
              author: {
                email: 'reviewer@example.com',
                id: 'reviewer@example.com',
                name: 'Reviewer',
              },
              body: 'Keep this requirement.',
              createdAt: '2026-06-24T00:00:00.000Z',
              id: 'message-1',
              updatedAt: '2026-06-24T00:00:00.000Z',
            },
          ],
          status: 'open',
          updatedAt: '2026-06-24T00:00:00.000Z',
        },
      ],
      version: 1,
    })),
    onPlanCloseRequested: vi.fn((callback) => {
      requestClose = callback;
      return () => {
        requestClose = null;
      };
    }),
    savePlanReview,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.plan-shell')).not.toBeNull();
    expect(requestClose).not.toBeNull();
    expect(container.querySelector('.plan-comment-thread')).not.toBeNull();
  });
  await act(async () => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  });
  savePlanReview.mockClear();
  blockPlanReviewSave = true;
  await act(async () => {
    requestClose?.();
  });
  await waitFor(() => {
    expect(savePlanReview).toHaveBeenCalledTimes(1);
  });
  expect(completePlan).not.toHaveBeenCalled();
  expect(
    [...container.querySelectorAll<HTMLElement>('[contenteditable]')].map((element) =>
      element.getAttribute('contenteditable'),
    ),
  ).toEqual(['false', 'false']);
  expect(container.querySelector<HTMLButtonElement>('.review-comment-delete')?.disabled).toBe(true);
  await act(async () => {
    resolvePlanReviewSave?.();
  });
  await waitFor(() => {
    expect(completePlan).toHaveBeenCalledTimes(1);
  });
  expect(completePlan).toHaveBeenCalledWith(
    expect.objectContaining({
      document: {
        id: 'plan:/tmp/plan.md',
        path: '/tmp/plan.md',
        version: 'plan-version',
      },
      threads: [
        expect.objectContaining({
          id: 'thread-1',
        }),
      ],
      version: 1,
    }),
    'closed',
  );
});

test('plan mode recovers from an unreadable review sidecar', async () => {
  const markPlanReady = vi.fn(async () => {});
  window.codiff = createCodiffMock({
    getLaunchOptions: vi.fn(async () => ({
      planFile: '/tmp/plan.md',
      planResultFile: '/tmp/result.json',
      repositoryPathProvided: true,
    })),
    getMarkdownDocument: vi.fn(async () => ({
      content: '# Execute this plan\n',
      id: 'plan:/tmp/plan.md',
      kind: 'plan' as const,
      path: '/tmp/plan.md',
      version: 'plan-version',
    })),
    getPlanReview: vi.fn(async () => {
      throw new Error('Invalid plan review.');
    }),
    markPlanReady,
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.plan-shell')).not.toBeNull();
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid plan review.');
  expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
  expect(markPlanReady).toHaveBeenCalledTimes(1);
});

test('repository changes automatically refresh the working tree', async () => {
  let onRepositoryChanged: ((change: { root: string }) => void) | null = null;
  const getRepositoryState = vi.fn(async () => repositoryState);

  window.codiff = createCodiffMock({
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      onRepositoryChanged = callback;
      return () => {
        onRepositoryChanged = null;
      };
    }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(onRepositoryChanged).not.toBeNull();
  });
  expect(container.querySelector('.repository-change-banner.visible')).toBeNull();
  expect(getRepositoryState).toHaveBeenCalledTimes(1);
  await act(async () => {
    onRepositoryChanged?.({ root: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector('.repository-change-banner.visible')).toBeNull();
  expect(getRepositoryState).toHaveBeenCalledTimes(2);
});

test('failed automatic refresh offers a manual retry without looping', async () => {
  let notify: () => void = vi.fn();
  const getRepositoryState = vi
    .fn(async () => repositoryState)
    .mockResolvedValueOnce(repositoryState)
    .mockRejectedValueOnce(new Error('Repository is temporarily unavailable'));
  window.codiff = createCodiffMock({
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      notify = () => callback({ root: '/repo' });
      return () => {};
    }),
  });
  await using view = await renderReact(<App />);
  await act(async () => notify());
  await waitFor(() => {
    expect(view.container.querySelector('.repository-change-banner.visible')).not.toBeNull();
  });
  expect(getRepositoryState).toHaveBeenCalledTimes(2);
  await act(async () => {
    view.container.querySelector<HTMLButtonElement>('.repository-change-reload')?.click();
  });
  expect(getRepositoryState).toHaveBeenCalledTimes(3);
  expect(view.container.querySelector('.repository-change-banner.visible')).toBeNull();
});

test.each([
  { ref: 'abc1234', type: 'commit' },
  { baseRef: 'main', headRef: 'feature', ref: 'feature', type: 'branch-working-tree' },
] satisfies Array<ReviewSource>)('local changes respect the $type source', async (source) => {
  let notify: () => void = vi.fn();
  const getRepositoryState = vi.fn(async () => ({ ...repositoryState, source }));
  window.codiff = createCodiffMock({
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      notify = () => callback({ root: '/repo' });
      return () => {};
    }),
  });
  await using _view = await renderReact(<App />);
  await act(async () => notify());
  expect(getRepositoryState).toHaveBeenCalledTimes(source.type === 'commit' ? 1 : 2);
  if (source.type === 'branch-working-tree') {
    expect(getRepositoryState).toHaveBeenLastCalledWith({ ref: 'feature', type: source.type });
  }
});

test('Done accepts the edited diff without fetching the full working-tree section again', async () => {
  const { Editor } = await import('@pierre/diffs/edit');
  const attached = vi.spyOn(Editor.prototype, 'edit');
  const getEditor = () => attached.mock.contexts[0] as InstanceType<typeof Editor> | undefined;
  await using _attached = {
    async [Symbol.asyncDispose]() {
      attached.mockRestore();
    },
  };
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
  await using _canvas = {
    async [Symbol.asyncDispose]() {
      canvas.mockRestore();
    },
  };
  const file = createChangedFile('source.txt');
  const originalSection = {
    ...file.sections[0]!,
    loadState: 'ready' as const,
    newFile: { contents: 'new\n', name: file.path },
    oldFile: { contents: 'old\n', name: file.path },
  };
  const refreshedSection = { ...file.sections[0]!, loadState: 'ready' as const };
  const pending = Promise.withResolvers<RepositoryState>();
  let savedContent = '';
  window.codiff = createCodiffMock({
    getDiffSectionContent: vi.fn(async () => ({
      ...originalSection,
      newFile: { contents: savedContent, name: file.path },
    })),
    getRepositoryState: vi
      .fn()
      .mockResolvedValueOnce({
        ...repositoryState,
        files: [{ ...file, sections: [originalSection] }],
      })
      .mockImplementation(() => pending.promise),
    saveRepositoryFile: vi.fn(async (request) => {
      savedContent = request.content;
      return { document: { ...request, version: 'saved' }, status: 'saved' as const };
    }),
  });
  await using app = await renderReact(<App />);
  const findEditableContent = () =>
    [...app.container.querySelectorAll('*')].flatMap((element) => [
      ...(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="textbox"]') ?? []),
    ])[0];
  await waitFor(() =>
    expect(app.container.querySelector(`[aria-label="Edit ${file.path}"]`)).not.toBeNull(),
  );
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${file.path}"]`)!.click(),
  );
  await waitFor(() => expect(findEditableContent()).toBeDefined());
  await waitFor(() => expect(getEditor()?.getFile()).toBeDefined());
  await act(async () => {
    getEditor()!.applyEdits([
      {
        newText: 'updated ',
        range: { end: { character: 0, line: 0 }, start: { character: 0, line: 0 } },
      },
    ]);
    app.container
      .querySelector<HTMLButtonElement>(`[aria-label="Done editing ${file.path}"]`)!
      .click();
  });
  await waitFor(() => expect(window.codiff.getRepositoryState).toHaveBeenCalledTimes(2));
  expect(window.codiff.getDiffSectionContent).not.toHaveBeenCalled();
  expect(savedContent).toContain('updated ');
  await waitFor(() =>
    expect(app.container.querySelector(`[aria-label="Edit ${file.path}"]`)).not.toBeNull(),
  );
  expect(app.container.querySelector(`[aria-label="Done editing ${file.path}"]`)).toBeNull();
  await act(async () =>
    pending.resolve({
      ...repositoryState,
      files: [{ ...file, fingerprint: 'saved', sections: [refreshedSection] }],
    }),
  );
});

test('automatic refresh updates changed files in place', async () => {
  const initialFile = {
    fingerprint: 'src/app.ts:1',
    path: 'src/app.ts',
    sections: [
      {
        binary: false,
        id: 'src/app.ts:unstaged',
        kind: 'unstaged',
        patch: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
      },
    ],
    status: 'modified',
  } satisfies ChangedFile;
  const addedFile = {
    fingerprint: 'src/added.ts:1',
    path: 'src/added.ts',
    sections: [
      {
        binary: false,
        id: 'src/added.ts:unstaged',
        kind: 'unstaged',
        patch: 'diff --git a/src/added.ts b/src/added.ts\n@@ -0,0 +1 @@\n+created\n',
      },
    ],
    status: 'added',
  } satisfies ChangedFile;

  let onRepositoryChanged: ((change: { root: string }) => void) | null = null;
  let stateRequests = 0;
  const getRepositoryState = vi.fn<Window['codiff']['getRepositoryState']>(async () => {
    stateRequests += 1;
    return stateRequests === 1
      ? { ...repositoryState, files: [initialFile] }
      : {
          ...repositoryState,
          files: [
            addedFile,
            {
              ...initialFile,
              fingerprint: 'src/app.ts:2',
              sections: [
                {
                  binary: false,
                  id: 'src/app.ts:unstaged',
                  kind: 'unstaged',
                  patch: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+newer\n',
                },
              ],
            },
          ],
        };
  });

  window.codiff = createCodiffMock({
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      onRepositoryChanged = callback;
      return () => {
        onRepositoryChanged = null;
      };
    }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(onRepositoryChanged).not.toBeNull();
  });
  expect(container.textContent).not.toContain('added.ts');
  await act(async () => {
    onRepositoryChanged?.({ root: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // New file appears without a window reload, and the banner clears.
  expect(getRepositoryState).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('added.ts');
  expect(container.querySelector('.repository-change-banner.visible')).toBeNull();
  // The changed file must not appear twice (old + new version).
  const appOccurrences = container.textContent?.split('app.ts').length ?? 1;
  expect(appOccurrences - 1).toBeLessThanOrEqual(2);
  expect(container.textContent).not.toContain('-old\n+new\n');
});

test('refreshing all changes re-resolves the branch snapshot', async () => {
  const initialSource = {
    baseRef: 'base123',
    headRef: 'head123',
    ref: 'main',
    type: 'branch-working-tree',
  } satisfies ReviewSource;
  const refreshedSource = {
    baseRef: 'base123',
    headRef: 'head456',
    ref: 'main',
    type: 'branch-working-tree',
  } satisfies ReviewSource;
  const initialFile = createChangedFile('src/initial.ts', { kind: 'commit' });
  const addedFile = createChangedFile('src/added.ts', { kind: 'commit' });
  const initialState = {
    ...repositoryState,
    branch: 'feature',
    files: [initialFile],
    source: initialSource,
  } satisfies RepositoryState;
  const refreshedState = {
    ...initialState,
    files: [initialFile, addedFile],
    source: refreshedSource,
  } satisfies RepositoryState;
  let onRepositoryChanged: ((change: { root: string }) => void) | null = null;
  let branchWorkingTreeRequests = 0;
  const getRepositoryState = vi.fn<Window['codiff']['getRepositoryState']>(
    async (requestedSource) => {
      if (requestedSource?.type === 'branch-diff') {
        return {
          ...refreshedState,
          source: requestedSource,
        };
      }
      branchWorkingTreeRequests += 1;
      return branchWorkingTreeRequests === 1 ? initialState : refreshedState;
    },
  );
  const getRepositoryHistory = vi.fn(async () => ({
    entries: [],
    root: '/repo',
  }));

  window.codiff = createCodiffMock({
    getLaunchOptions: vi.fn(async () => ({
      repositoryPathProvided: true,
      source: { ref: 'main', type: 'branch-working-tree' as const },
    })),
    getRepositoryHistory,
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      onRepositoryChanged = callback;
      return () => {
        onRepositoryChanged = null;
      };
    }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;
  const findButton = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
    expect(onRepositoryChanged).not.toBeNull();
  });
  await act(async () => {
    onRepositoryChanged?.({ root: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => {
    expect(container.textContent).toContain('added.ts');
  });
  expect(getRepositoryState).toHaveBeenNthCalledWith(2, {
    ref: 'main',
    type: 'branch-working-tree',
  });
  expect(getRepositoryHistory).toHaveBeenLastCalledWith(expect.any(Number), {
    ref: 'main',
    type: 'branch-working-tree',
  });
  await waitFor(() => {
    expect(findButton('Committed only vs main')).toBeTruthy();
  });
  await act(async () => {
    findButton('Committed only vs main')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(getRepositoryState).toHaveBeenLastCalledWith({
    baseRef: refreshedSource.baseRef,
    headRef: refreshedSource.headRef,
    ref: refreshedSource.ref,
    type: 'branch-diff',
  });
});

test('refreshing changed viewed files expands them in place', async () => {
  const initialFile = createChangedFile('src/viewed.ts', {
    fingerprint: 'viewed:1',
  });
  const refreshedFile = createChangedFile('src/viewed.ts', {
    fingerprint: 'viewed:2',
    patch: 'diff --git a/src/viewed.ts b/src/viewed.ts\n@@ -1 +1 @@\n-old\n+newer\n',
  });
  window.localStorage.setItem(
    'codiff:viewed:/repo',
    JSON.stringify({ [initialFile.path]: initialFile.fingerprint }),
  );

  let onRepositoryChanged: ((change: { root: string }) => void) | null = null;
  let stateRequests = 0;
  const getRepositoryState = vi.fn<Window['codiff']['getRepositoryState']>(async () => {
    stateRequests += 1;
    return {
      ...repositoryState,
      files: [stateRequests === 1 ? initialFile : refreshedFile],
    };
  });

  window.codiff = createCodiffMock({
    getRepositoryState,
    onRepositoryChanged: vi.fn((callback) => {
      onRepositoryChanged = callback;
      return () => {
        onRepositoryChanged = null;
      };
    }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    const header = container.querySelector('.codiff-file-header');
    expect(header).not.toBeNull();
    expect(header?.classList.contains('collapsed')).toBe(true);
  });
  await act(async () => {
    onRepositoryChanged?.({ root: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => {
    const header = container.querySelector('.codiff-file-header');
    expect(header).not.toBeNull();
    expect(header?.classList.contains('collapsed')).toBe(false);
    expect(header?.querySelector('.codiff-viewed-button')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});

test('history filter matches commits by author name', async () => {
  window.codiff = createCodiffMock({
    getRepositoryHistory: vi.fn(async () => ({
      entries: [
        {
          author: 'Ada Lovelace',
          committedAt: Date.now(),
          parents: [],
          ref: 'aaa1111',
          subject: 'Fix parser',
        },
        {
          author: 'Grace Hopper',
          committedAt: Date.now(),
          parents: [],
          ref: 'bbb2222',
          subject: 'Update docs',
        },
      ],
      root: '/repo',
    })),
  });

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  const historySubjects = () =>
    Array.from(container.querySelectorAll('.history-entry-subject')).map(
      (element) => element.textContent,
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await waitFor(() => {
    expect(container.querySelector('.loading')).toBeNull();
  });
  await waitFor(() => {
    expect(historySubjects()).toContain('Fix parser');
    expect(historySubjects()).toContain('Update docs');
  });
  const searchInput = container.querySelector<HTMLInputElement>('.history-sidebar .sidebar-search');
  expect(searchInput).toBeTruthy();
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setInputValue?.call(searchInput, 'grace');
    searchInput?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitFor(() => {
    expect(historySubjects()).toContain('Update docs');
    expect(historySubjects()).not.toContain('Fix parser');
  });
});
