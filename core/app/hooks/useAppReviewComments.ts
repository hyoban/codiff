import { useState } from 'react';
import type { ReviewComment } from '../../lib/app-types.ts';
import { getPendingPullRequestReviewComments } from '../../lib/review-comments.ts';
import { useReviewCommentDrafts } from './useReviewCommentDrafts.ts';
export function useAppReviewComments({
  onCommentFileChange,
}: {
  onCommentFileChange: (path: string) => void;
}) {
  const [reviewComments, setReviewComments] = useState<ReadonlyArray<ReviewComment>>([]);
  const commentDrafts = useReviewCommentDrafts({
    comments: reviewComments,
    onCommentFileChange,
    setComments: setReviewComments,
  });
  return {
    ...commentDrafts,
    hasPendingReviewComments:
      getPendingPullRequestReviewComments(
        reviewComments,
        commentDrafts.activeReviewCommentDraftState,
      ).length > 0,
    reviewComments,
    setReviewComments,
  };
}
