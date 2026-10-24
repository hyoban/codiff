/** @vitest-environment jsdom */
import { act } from 'react';
import { expect, test, vi } from 'vite-plus/test';
import { useAppReviewComments } from '../app/hooks/useAppReviewComments.ts';
import { renderReact } from './helpers/react.tsx';

test('review comments stay local and remain editable and copyable', async () => {
  let state: ReturnType<typeof useAppReviewComments>;
  const changed = vi.fn();
  function Harness({
    onState,
  }: {
    onState: (value: ReturnType<typeof useAppReviewComments>) => void;
  }) {
    onState(useAppReviewComments({ onCommentFileChange: changed }));
    return null;
  }
  await using _view = await renderReact(
    <Harness
      onState={(value) => {
        state = value;
      }}
    />,
  );
  await act(async () =>
    state.createComment({
      filePath: 'a.ts',
      lineNumber: 1,
      sectionId: 'a.ts:unstaged',
      side: 'additions',
    }),
  );
  const comment = state!.reviewComments[0]!;
  await act(async () => state.updateComment(comment.id, 'Please check this.'));
  expect(state!.reviewComments[0]?.body).toBe('Please check this.');
  expect(state!.hasPendingReviewComments).toBe(true);
  expect('submitPullRequestComment' in state!).toBe(false);
  expect('submitPullRequestReview' in state!).toBe(false);
  await act(async () => state.deleteComment(comment.id));
  expect(state!.reviewComments).toEqual([]);
});
