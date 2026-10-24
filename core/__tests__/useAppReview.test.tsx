/** @vitest-environment jsdom */
import { act } from 'react';
import { expect, test } from 'vite-plus/test';
import { useAppReview } from '../app/hooks/useAppReview.ts';
import type { RepositoryState } from '../types.ts';
import { createChangedFile } from './helpers/fixtures.ts';
import { renderReact } from './helpers/react.tsx';

test('manual commit drafts and exclusions survive refresh and reset with the repository', async () => {
  let state: RepositoryState = {
    branch: 'main',
    files: [createChangedFile('a.ts'), createChangedFile('b.ts')],
    generatedAt: 1,
    launchPath: '/repo',
    root: '/repo',
    source: { type: 'working-tree' },
  };
  const stateRef = { current: state };
  let review: ReturnType<typeof useAppReview>;
  function Harness({
    onState,
    state,
  }: {
    onState: (next: ReturnType<typeof useAppReview>) => void;
    state: RepositoryState;
  }) {
    onState(useAppReview({ state, stateRef }));
    return null;
  }
  await using view = await renderReact(
    <Harness
      onState={(next) => {
        review = next;
      }}
      state={state}
    />,
  );
  expect([...review!.commitDraft.commitSelected]).toEqual(['a.ts', 'b.ts']);
  await act(async () => {
    review!.commitDraft.setCommitSubject('Keep this subject.');
    review!.commitDraft.setCommitBody('Keep this body.');
    review!.commitDraft.toggleCommitFile('b.ts');
    review!.openCommitView();
  });
  state = { ...state, files: [...state.files, createChangedFile('c.ts')], generatedAt: 2 };
  stateRef.current = state;
  await view.rerender(
    <Harness
      onState={(next) => {
        review = next;
      }}
      state={state}
    />,
  );
  expect(review!.showCommitView).toBe(true);
  expect(review!.commitDraft.commitSubject).toBe('Keep this subject.');
  expect(review!.commitDraft.commitBody).toBe('Keep this body.');
  expect([...review!.commitDraft.commitSelected]).toEqual(['a.ts', 'c.ts']);

  state = { ...state, files: [createChangedFile('other.ts')], root: '/other' };
  stateRef.current = state;
  await view.rerender(
    <Harness
      onState={(next) => {
        review = next;
      }}
      state={state}
    />,
  );
  expect(review!.commitDraft.commitSubject).toBe('');
  expect(review!.commitDraft.commitBody).toBe('');
  expect([...review!.commitDraft.commitSelected]).toEqual(['other.ts']);

  state = { ...state, source: { ref: 'HEAD', type: 'commit' } };
  stateRef.current = state;
  await view.rerender(
    <Harness
      onState={(next) => {
        review = next;
      }}
      state={state}
    />,
  );
  await act(async () => review!.openCommitView());
  expect(review!.showCommitView).toBe(false);
});
