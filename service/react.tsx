import { PlanReviewSurface, type PlanReviewCommenting } from '@nkzw/codiff-core/react';
import type { ComponentProps } from 'react';
export type SharedPlanCommenting = PlanReviewCommenting;
export function SharedPlanApp({
  providerLabel,
  ...props
}: Omit<ComponentProps<typeof PlanReviewSurface>, 'signInLabel'> & {
  providerLabel: string;
}) {
  return <PlanReviewSurface {...props} signInLabel={`Sign in with ${providerLabel} to comment`} />;
}
