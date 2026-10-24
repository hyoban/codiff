/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { expect, test, vi } from 'vite-plus/test';
import { useRepositoryAutoRefresh } from '../app/hooks/useRepositoryAutoRefresh.ts';
import { renderReact } from './helpers/react.tsx';

function Harness({ enabled = true, refresh }: { enabled?: boolean; refresh: () => Promise<void> }) {
  useRepositoryAutoRefresh(enabled, refresh);
  return null;
}

test('changes during a refresh are coalesced into a follow-up and unsubscribe on unmount', async () => {
  let notify: () => void = vi.fn();
  const unsubscribe = vi.fn();
  window.codiff = {
    ...window.codiff,
    onRepositoryChanged: (callback) => {
      notify = () => callback({ root: '/repo' });
      return unsubscribe;
    },
  };
  const pending = Promise.withResolvers<void>();
  const refresh = vi.fn(async () => {}).mockReturnValueOnce(pending.promise);
  const view = await renderReact(<Harness refresh={refresh} />);
  await act(async () => notify());
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    notify();
    notify();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => notify());
  expect(refresh).toHaveBeenCalledTimes(3);
  await view[Symbol.asyncDispose]();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('changes received while loading are refreshed once it finishes', async () => {
  let notify: () => void = vi.fn();
  window.codiff = {
    ...window.codiff,
    onRepositoryChanged: (callback) => {
      notify = () => callback({ root: '/repo' });
      return () => {};
    },
  };
  const refresh = vi.fn(async () => {});
  await using view = await renderReact(<Harness enabled={false} refresh={refresh} />);
  await act(async () => {
    notify();
    notify();
  });
  expect(refresh).not.toHaveBeenCalled();
  await view.rerender(<Harness refresh={refresh} />);
  expect(refresh).toHaveBeenCalledOnce();
});
