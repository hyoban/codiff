/** @vitest-environment jsdom */
import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { createChangedFile } from './helpers/fixtures.ts';
import { renderReact } from './helpers/react.tsx';
import {
  codeViewMock,
  resetCodeViewMock,
  ReviewCodeViewHarness,
} from './helpers/review-code-view.tsx';

const file = createChangedFile('core/a/long/directory/important-file.txt');
beforeEach(resetCodeViewMock);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('narrow pane layout and sticky header metrics resize together without losing the filename', async () => {
  let width = 600;
  let resize: (() => void) | undefined;
  const getRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('code-view')
      ? new DOMRect(0, 0, width, 768)
      : getRect.call(this);
  });
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(element: Element) {
        if (element.classList.contains('code-view')) {
          resize = () => this.callback([], this);
        }
      }
      disconnect() {}
      unobserve() {}
    },
  );
  await using view = await renderReact(<ReviewCodeViewHarness files={[file]} />);
  const viewport = view.container.querySelector<HTMLElement>('.code-view')!;
  expect(viewport.classList.contains('compact-file-headers')).toBe(true);
  expect(codeViewMock.lastOptions?.itemMetrics).toEqual({ diffHeaderHeight: 90 });
  expect(viewport.style.getPropertyValue('--codiff-file-header-height')).toBe('90px');
  const header = view.container.querySelector('.codiff-file-header')!;
  expect(header.children[0]?.classList.contains('codiff-header-toggle')).toBe(true);
  expect(header.children[1]?.classList.contains('codiff-file-details')).toBe(true);
  expect(header.querySelector('.codiff-file-name')?.textContent).toBe('important-file.txt');
  expect(header.querySelector('.codiff-file-path')?.getAttribute('title')).toBe(file.path);
  await act(async () => {
    width = 1200;
    resize!();
  });
  expect(viewport.classList.contains('compact-file-headers')).toBe(false);
  expect(codeViewMock.lastOptions?.itemMetrics).toEqual({ diffHeaderHeight: 54 });
  expect(viewport.style.getPropertyValue('--codiff-file-header-height')).toBe('54px');
});

test('expandUnchanged only expands diffs when full file contents can be loaded', async () => {
  const loadContents = vi.fn();
  await using view = await renderReact(
    <ReviewCodeViewHarness expandUnchanged files={[file]} onLoadSectionContents={loadContents} />,
  );
  expect(codeViewMock.lastOptions?.expandUnchanged).toBe(true);

  await view.rerender(
    <ReviewCodeViewHarness
      expandUnchanged
      files={[file]}
      isReadOnly
      onLoadSectionContents={loadContents}
    />,
  );
  expect(codeViewMock.lastOptions?.expandUnchanged).toBe(false);
});

test('working-tree diffs retain viewed state and external opening without inline editing', async () => {
  const openFile = vi.fn();
  await using view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onOpenFile={openFile} />,
  );
  expect(view.container.querySelector(`[aria-label="Edit ${file.path}"]`)).toBeNull();
  expect(view.container.querySelector('.codiff-viewed-button')).not.toBeNull();
  await act(async () =>
    view.container
      .querySelector<HTMLButtonElement>(`[aria-label="Open ${file.path} in editor"]`)
      ?.click(),
  );
  expect(openFile).toHaveBeenCalledWith(file);
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: 'e',
    metaKey: true,
  });
  await act(async () => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(codeViewMock.lastItems.every((item) => !item.edit)).toBe(true);
});
