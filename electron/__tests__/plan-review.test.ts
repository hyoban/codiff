import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';
import type { PlanReview } from '../../core/types.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { getPlanReviewPath, readPlanReview, resolvePlanReviewThreadsAtPath, writePlanReview } =
  require('../plan-review.cjs') as {
    getPlanReviewPath: (userDataPath: string, planFile: string) => string;
    readPlanReview: (userDataPath: string, planFile: string) => Promise<PlanReview | null>;
    resolvePlanReviewThreadsAtPath: (
      path: string,
      threadIds: ReadonlyArray<string>,
      reason: 'agent-handled' | 'anchor-removed',
    ) => Promise<{
      missingIds: ReadonlyArray<string>;
      resolvedIds: ReadonlyArray<string>;
      review: PlanReview;
    }>;
    writePlanReview: (
      userDataPath: string,
      planFile: string,
      review: unknown,
    ) => Promise<PlanReview>;
  };

const createReview = (body: string): PlanReview => {
  const author = {
    email: 'reviewer@example.com',
    id: 'reviewer@example.com',
    name: 'Reviewer',
  };
  return {
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
            text: 'Execute the plan',
            type: 'heading',
          },
          kind: 'block',
          version: 1,
        },
        createdAt: '2026-06-24T00:00:00.000Z',
        createdBy: author,
        id: 'thread-1',
        messages: [
          {
            author,
            body,
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
  };
};

const addThread = (review: PlanReview, id: string, body: string): PlanReview => {
  const source = review.threads[0]!;
  return {
    ...review,
    threads: [
      ...review.threads,
      {
        ...source,
        id,
        messages: source.messages.map((message) => ({
          ...message,
          body,
          id: `${id}-message`,
        })),
      },
    ],
  };
};

test('plan reviews round trip through the sidecar store', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-');
  const planFile = join(directory.path, 'plan.md');
  const review = createReview('Keep this requirement explicit.');

  await expect(readPlanReview(directory.path, planFile)).resolves.toBeNull();
  await expect(writePlanReview(directory.path, planFile, review)).resolves.toEqual(review);
  await expect(readPlanReview(directory.path, planFile)).resolves.toEqual(review);
});

test('plan review resolution metadata round trips through the sidecar store', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-');
  const planFile = join(directory.path, 'plan.md');
  const review = createReview('Keep this requirement explicit.');
  const resolvedReview = {
    ...review,
    threads: review.threads.map((thread) => ({
      ...thread,
      resolution: {
        reason: 'agent-handled' as const,
        resolvedAt: '2026-06-25T00:00:00.000Z',
      },
      status: 'resolved' as const,
      updatedAt: '2026-06-25T00:00:00.000Z',
    })),
  };

  await expect(writePlanReview(directory.path, planFile, resolvedReview)).resolves.toEqual(
    resolvedReview,
  );
  await expect(readPlanReview(directory.path, planFile)).resolves.toEqual(resolvedReview);
});

test('resolves selected open plan comments by review path', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-');
  const planFile = join(directory.path, 'plan.md');
  const review = createReview('Handle this comment.');
  const secondThread = {
    ...review.threads[0],
    id: 'thread-2',
    messages: review.threads[0]!.messages.map((message) => ({
      ...message,
      id: 'message-2',
    })),
  };
  const alreadyResolved = {
    ...review.threads[0],
    id: 'thread-3',
    resolution: {
      reason: 'anchor-removed' as const,
      resolvedAt: '2026-06-24T01:00:00.000Z',
    },
    status: 'resolved' as const,
    updatedAt: '2026-06-24T01:00:00.000Z',
  };
  const reviewPath = getPlanReviewPath(directory.path, planFile);

  await writePlanReview(directory.path, planFile, {
    ...review,
    threads: [review.threads[0]!, secondThread, alreadyResolved],
  });
  const result = await resolvePlanReviewThreadsAtPath(
    reviewPath,
    ['thread-1', 'thread-3', 'missing-thread'],
    'agent-handled',
  );

  expect(result.resolvedIds).toEqual(['thread-1']);
  expect(result.missingIds).toEqual(['missing-thread']);
  expect(result.review.threads).toEqual([
    expect.objectContaining({
      id: 'thread-1',
      resolution: expect.objectContaining({
        reason: 'agent-handled',
        resolvedAt: expect.any(String),
      }),
      status: 'resolved',
      updatedAt: expect.any(String),
    }),
    secondThread,
    alreadyResolved,
  ]);
  await expect(readPlanReview(directory.path, planFile)).resolves.toEqual(result.review);
});

test('concurrent plan review saves and resolutions preserve both updates', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-race-');
  const planFile = join(directory.path, 'plan.md');
  const review = createReview('Handle this comment.');
  const reviewWithNewThread = addThread(review, 'thread-2', 'Keep this new comment.');
  const reviewPath = getPlanReviewPath(directory.path, planFile);

  await writePlanReview(directory.path, planFile, review);
  await Promise.all([
    writePlanReview(directory.path, planFile, reviewWithNewThread),
    resolvePlanReviewThreadsAtPath(reviewPath, ['thread-1'], 'agent-handled'),
  ]);

  await expect(readPlanReview(directory.path, planFile)).resolves.toEqual(
    expect.objectContaining({
      threads: [
        expect.objectContaining({
          id: 'thread-1',
          resolution: expect.objectContaining({ reason: 'agent-handled' }),
          status: 'resolved',
        }),
        expect.objectContaining({
          id: 'thread-2',
          status: 'open',
        }),
      ],
    }),
  );
});

test('queued plan review writes preserve invocation order and leave no temporary files', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-');
  const planFile = join(directory.path, 'plan.md');
  const reviews = ['First', 'Second', 'Final'].map(createReview);

  await Promise.all(reviews.map((review) => writePlanReview(directory.path, planFile, review)));
  await expect(readPlanReview(directory.path, planFile)).resolves.toEqual(reviews.at(-1));

  const reviewPath = getPlanReviewPath(directory.path, planFile);
  expect(await readdir(dirname(reviewPath))).toEqual([reviewPath.split('/').at(-1)]);
});

test('invalid plan review schemas are rejected on write and read', async () => {
  await using directory = await createTemporaryDirectory('codiff-plan-review-');
  const planFile = join(directory.path, 'plan.md');
  const invalidReview = {
    ...createReview('Invalid'),
    threads: [{ id: 'missing-required-fields' }],
  };

  await expect(writePlanReview(directory.path, planFile, invalidReview)).rejects.toThrow(
    'Invalid plan review.',
  );

  const reviewPath = getPlanReviewPath(directory.path, planFile);
  await mkdir(dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, `${JSON.stringify(invalidReview)}\n`);
  await expect(readPlanReview(directory.path, planFile)).rejects.toThrow('Invalid plan review.');
});
