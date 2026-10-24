import type { SharedPlanSnapshot } from '@nkzw/codiff-core';
import { parsePlanShareManifest } from '@nkzw/codiff-core/share';
import {
  createFateServer,
  createResolver,
  FateRequestError,
  type LiveEventBus,
  type SourceDefinition,
} from '@nkzw/fate/server';
import { createDrizzleSourceAdapter } from '@nkzw/fate/server/drizzle';
import { count } from 'drizzle-orm';
import { z } from 'zod';
import type { SharingBucket, SharingEnv } from './api.ts';
import {
  and,
  createDb,
  eq,
  gte,
  runDatabaseBatches,
  sql,
  type Database,
  type DatabaseBatchStatement,
} from './db.ts';
import schema, {
  plan,
  shareCommentMessage,
  shareCommentThread,
  uploadIntent,
  user,
  walkthrough,
  type ShareCommentThreadRow,
  type UserRow,
} from './schema.ts';
import { hashUploadIntentSecret, verifyUploadIntentSecret } from './upload-intent.ts';
import {
  SharingRoot,
  getSessionUserId,
  planDataView,
  shareCommentMessageDataView,
  shareCommentThreadDataView,
  shareStatsDataView,
  uploadIntentDataView,
  uploadIntentSecretHeader,
  type ShareStatsRecord,
} from './views.ts';

export type SharingAuth = {
  api: {
    getSession(options: {
      asResponse?: false;
      headers: Headers;
      returnHeaders?: boolean;
    }): Promise<unknown>;
  };
};

export type SharingFateEnv = SharingEnv & Record<string, unknown>;

type SharingLive = LiveEventBus;

export type SharingFateContext = {
  auth: SharingAuth | null;
  db: Database;
  env: SharingFateEnv;
  request: Request;
};

type CreateSharingFateServerOptions = {
  live: SharingLive;
  providerLabel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isBetterAuthApi = (value: unknown): value is SharingAuth =>
  isRecord(value) && isRecord(value.api) && typeof value.api.getSession === 'function';

const isFateEnv = (value: unknown): value is SharingFateEnv =>
  isRecord(value) && isRecord(value.DB) && typeof value.DB.prepare === 'function';

const isDatabase = (value: unknown): value is Database =>
  isRecord(value) && typeof value.select === 'function' && typeof value.batch === 'function';

const getAuthenticatedUserId = async (context: SharingFateContext) => {
  if (!context.auth) {
    return null;
  }
  return getSessionUserId(
    await context.auth.api.getSession({
      asResponse: false,
      headers: context.request.headers,
    }),
  );
};

const getShareCommentAuthorUsername = (
  commenter: Pick<UserRow, 'displayUsername' | 'name' | 'username'>,
) => commenter.displayUsername || commenter.username || commenter.name;

const validDate = (value: string | undefined, fallback: Date) => {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
};

const importedThreadId = (parentId: string, sourceThreadId: string) =>
  `imported:${parentId}:${sourceThreadId}`;

const importPlanComments = async (
  database: Database,
  planId: string,
  snapshot: SharedPlanSnapshot,
) => {
  const statements: Array<DatabaseBatchStatement> = [];
  for (const thread of snapshot.review.threads) {
    const sourceThreadId = `plan:${thread.id}`;
    const threadId = importedThreadId(planId, sourceThreadId);
    statements.push(
      database
        .insert(shareCommentThread)
        .values({
          anchorJson: JSON.stringify(thread.anchor),
          createdAt: validDate(thread.createdAt, new Date()),
          id: threadId,
          kind: 'plan',
          planId,
          resolvedAt:
            thread.status === 'resolved'
              ? validDate(thread.resolution?.resolvedAt, new Date())
              : null,
          sourceThreadId,
          status: thread.status,
          updatedAt: validDate(thread.updatedAt, new Date()),
        })
        .onConflictDoNothing(),
    );
    for (const message of thread.messages) {
      statements.push(
        database
          .insert(shareCommentMessage)
          .values({
            authorImage: message.author.avatarUrl ?? null,
            authorName: message.author.name,
            authorUserId: null,
            authorUsername: message.author.username ?? null,
            body: message.body,
            createdAt: validDate(message.createdAt, new Date()),
            id: crypto.randomUUID(),
            sourceMessageId: `plan:${message.id}`,
            threadId,
            updatedAt: validDate(message.updatedAt, new Date()),
          })
          .onConflictDoNothing(),
      );
    }
  }
  await runDatabaseBatches(database, statements);
  await database.update(plan).set({ commentsImportedAt: new Date() }).where(eq(plan.id, planId));
};

const readManifest = async (bucket: SharingBucket, objectKey: string) => {
  const object = await bucket.get(objectKey);
  if (!object) {
    throw new Error('Shared manifest not found.');
  }
  return new Response(object.body).json();
};

const ensurePlanCommentsImported = async (
  database: Database,
  bucket: SharingBucket,
  record: { commentsImportedAt: Date | null; id: string; objectKey: string },
) => {
  if (!record.commentsImportedAt) {
    await importPlanComments(
      database,
      record.id,
      parsePlanShareManifest(await readManifest(bucket, record.objectKey)),
    );
  }
};

const fetchShareStats = async (database: Database, now = new Date()): Promise<ShareStatsRecord> => {
  const dayMilliseconds = 24 * 60 * 60 * 1000;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - 6 * dayMilliseconds);
  const dayForPlan = sql<string>`date(${plan.createdAt}, 'unixepoch')`;
  const dayForWalkthrough = sql<string>`date(${walkthrough.createdAt}, 'unixepoch')`;
  const [planTotals, walkthroughTotals, planDays, walkthroughDays] = await database.batch([
    database.select({ count: count() }).from(plan),
    database.select({ count: count() }).from(walkthrough),
    database
      .select({ count: count(), date: dayForPlan })
      .from(plan)
      .where(gte(plan.createdAt, start))
      .groupBy(dayForPlan),
    database
      .select({ count: count(), date: dayForWalkthrough })
      .from(walkthrough)
      .where(gte(walkthrough.createdAt, start))
      .groupBy(dayForWalkthrough),
  ]);
  const plansByDate = new Map(planDays.map((entry) => [entry.date, entry.count]));
  const walkthroughsByDate = new Map(walkthroughDays.map((entry) => [entry.date, entry.count]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * dayMilliseconds).toISOString().slice(0, 10);
    return {
      date,
      id: `share-stats-day:${date}`,
      mergeRequestWalkthroughs: 0,
      plans: plansByDate.get(date) ?? 0,
      walkthroughs: walkthroughsByDate.get(date) ?? 0,
    };
  });
  return {
    days,
    id: 'share-stats',
    maxDailyShares: Math.max(0, ...days.flatMap((day) => [day.plans, day.walkthroughs])),
    totalMergeRequestWalkthroughs: 0,
    totalPlans: planTotals[0]?.count ?? 0,
    totalWalkthroughs: walkthroughTotals[0]?.count ?? 0,
  };
};

const shareCommentBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(128 * 1024);
const shareCommentAnchorBlockSchema = z.object({
  fingerprint: z.string().min(1).max(256),
  path: z.array(z.number().int().min(0).max(1_000_000)).max(64),
  runtimeKey: z.string().max(256).optional(),
  text: z.string().max(64 * 1024),
  type: z.string().min(1).max(64),
});
export const shareCommentAnchorSchema = z
  .object({
    block: shareCommentAnchorBlockSchema,
    kind: z.enum(['block', 'text']),
    quote: z
      .object({
        end: z.number().int().min(0).max(1_000_000),
        exact: z.string().max(64 * 1024),
        prefix: z.string().max(1024),
        start: z.number().int().min(0).max(1_000_000),
        suffix: z.string().max(1024),
      })
      .refine(({ end, start }) => end >= start, 'Invalid quote range.')
      .optional(),
    version: z.literal(1),
  })
  .refine(({ kind, quote }) => kind !== 'text' || quote != null, {
    message: 'Text anchors require a quote.',
    path: ['quote'],
  });
export const shareCommentTargetSchema = z.object({
  anchor: shareCommentAnchorSchema,
  kind: z.literal('plan'),
});
const createShareCommentThreadInput = z.object({
  body: shareCommentBodySchema,
  shareId: z.string().min(1).max(256),
  shareType: z.literal('plan'),
  target: shareCommentTargetSchema,
});
const replyShareCommentInput = z.object({
  body: shareCommentBodySchema,
  threadId: z.string().min(1).max(256),
});
const updateShareCommentInput = z.object({
  body: shareCommentBodySchema,
  messageId: z.string().min(1).max(256),
});
const deleteShareCommentInput = z.object({
  id: z.string().min(1).max(256),
});
const deleteShareInput = z.object({
  id: z.string().min(1).max(256),
});
const resolveShareCommentThreadInput = z.object({
  resolved: z.boolean(),
  threadId: z.string().min(1).max(256),
});

const databaseViews = {
  planBySlug: planDataView,
  shareCommentMessage: shareCommentMessageDataView,
  shareCommentThread: shareCommentThreadDataView,
  uploadIntentByCode: uploadIntentDataView,
};

const getCommentThread = async (context: SharingFateContext, threadId: string) => {
  const [thread] = await context.db
    .select()
    .from(shareCommentThread)
    .where(eq(shareCommentThread.id, threadId))
    .limit(1);
  if (!thread || !thread.planId) {
    throw new FateRequestError('NOT_FOUND', 'Comment thread not found.');
  }
  return thread;
};

const getThreadOwnerId = async (context: SharingFateContext, thread: ShareCommentThreadRow) => {
  if (thread.planId) {
    const [record] = await context.db
      .select({ ownerId: plan.sharedByUserId })
      .from(plan)
      .where(eq(plan.id, thread.planId))
      .limit(1);
    return record?.ownerId ?? null;
  }
  return null;
};

export const createSharingFateServer = ({
  live,
  providerLabel,
}: CreateSharingFateServerOptions) => {
  const sources = createDrizzleSourceAdapter<SharingFateContext>({
    db: ({ db: database }) => database,
    schema,
    views: databaseViews,
  });
  const customSources = new WeakMap<object, SourceDefinition>();
  const sourceRegistry = new Map(sources.registry);
  const allSources = {
    getSource: <Item extends Record<string, unknown>>(
      target:
        | SourceDefinition<Item, unknown>
        | {
            fields: Record<string, unknown>;
            typeName: string;
          },
    ): SourceDefinition<Item, unknown> => {
      if ('view' in target && 'id' in target) {
        return target;
      }
      if (target.typeName !== 'ShareStats' && target.typeName !== 'ShareStatsDay') {
        return sources.getSource(target as never);
      }
      let source = customSources.get(target) as SourceDefinition<Item, unknown> | undefined;
      if (!source) {
        source = { id: 'id', view: target as never };
        customSources.set(target, source);
        sourceRegistry.set(source, {});
      }
      return source;
    },
    registry: sourceRegistry,
  };

  const requireAuthenticatedUser = async (context: SharingFateContext): Promise<UserRow> => {
    const userId = await getAuthenticatedUserId(context);
    if (!userId) {
      throw new FateRequestError('UNAUTHORIZED', `Sign in with ${providerLabel} to continue.`);
    }
    const [record] = await context.db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!record || record.banned) {
      throw new FateRequestError('UNAUTHORIZED', 'This account cannot comment.');
    }
    return record;
  };

  const publishThreadInsert = (thread: ShareCommentThreadRow) => {
    if (thread.planId) {
      live
        .connection('Plan.commentThreads', { id: thread.planId })
        .appendNode('ShareCommentThread', thread.id);
    }
  };

  const publishThreadDelete = (thread: ShareCommentThreadRow) => {
    if (thread.planId) {
      live
        .connection('Plan.commentThreads', { id: thread.planId })
        .deleteEdge('ShareCommentThread', thread.id);
    }
    live.delete('ShareCommentThread', thread.id);
  };

  return createFateServer({
    context: ({ adapterContext, request }) => {
      const context = isRecord(adapterContext) ? adapterContext : {};
      const env = context.env;
      if (!isFateEnv(env)) {
        throw new Error('Fate requires the D1 DB binding.');
      }
      return {
        auth: isBetterAuthApi(context.auth) ? context.auth : null,
        db: isDatabase(context.db) ? context.db : createDb(env.DB),
        env,
        request,
      };
    },
    live,
    mutations: {
      'plan.delete': {
        input: deleteShareInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof deleteShareInput>;
          select: Array<string>;
        }) => {
          const owner = await requireAuthenticatedUser(ctx);
          const [record] = await ctx.db.select().from(plan).where(eq(plan.id, input.id)).limit(1);
          if (!record) {
            throw new FateRequestError('NOT_FOUND', 'Shared plan not found.');
          }
          if (record.sharedByUserId !== owner.id) {
            throw new FateRequestError('FORBIDDEN', 'Only the share owner can delete this plan.');
          }
          const deleted = await createResolver({
            ctx,
            select,
            view: planDataView,
          }).resolve(record);
          await ctx.env.WALKTHROUGH_BUCKET.delete(record.objectKey);
          const deletedRows = await ctx.db
            .delete(plan)
            .where(and(eq(plan.id, record.id), eq(plan.sharedByUserId, owner.id)))
            .returning({ id: plan.id });
          if (deletedRows.length === 0) {
            throw new FateRequestError('NOT_FOUND', 'Shared plan not found.');
          }
          return deleted;
        },
        type: 'Plan',
      },
      'shareComment.createThread': {
        input: createShareCommentThreadInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof createShareCommentThreadInput>;
          select: Array<string>;
        }) => {
          const commenter = await requireAuthenticatedUser(ctx);
          const now = new Date();
          const threadId = crypto.randomUUID();
          const messageId = crypto.randomUUID();

          if (input.target.kind !== 'plan') {
            throw new FateRequestError('BAD_REQUEST', 'A plan comment needs a plan target.');
          }
          const [record] = await ctx.db
            .select({ id: plan.id })
            .from(plan)
            .where(eq(plan.id, input.shareId))
            .limit(1);
          if (!record) {
            throw new FateRequestError('NOT_FOUND', 'Shared plan not found.');
          }
          const thread: ShareCommentThreadRow = {
            anchorJson: JSON.stringify(input.target.anchor),
            createdAt: now,
            filePath: null,
            id: threadId,
            kind: 'plan',
            lineNumber: null,
            planId: record.id,
            resolvedAt: null,
            sectionId: null,
            side: null,
            sourceThreadId: null,
            startLineNumber: null,
            startSide: null,
            status: 'open',
            updatedAt: now,
            walkthroughId: null,
          };

          await ctx.db.batch([
            ctx.db.insert(shareCommentThread).values(thread),
            ctx.db.insert(shareCommentMessage).values({
              authorImage: commenter.image,
              authorName: commenter.name,
              authorUserId: commenter.id,
              authorUsername: getShareCommentAuthorUsername(commenter),
              body: input.body,
              createdAt: now,
              id: messageId,
              threadId,
              updatedAt: now,
            }),
          ]);
          publishThreadInsert(thread);
          return sources.resolveById({
            ctx,
            id: threadId,
            input: { select },
            view: shareCommentThreadDataView,
          });
        },
        type: 'ShareCommentThread',
      },
      'shareComment.deleteMessage': {
        input: deleteShareCommentInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof deleteShareCommentInput>;
          select: Array<string>;
        }) => {
          const commenter = await requireAuthenticatedUser(ctx);
          const [message] = await ctx.db
            .select()
            .from(shareCommentMessage)
            .where(eq(shareCommentMessage.id, input.id))
            .limit(1);
          if (!message) {
            throw new FateRequestError('NOT_FOUND', 'Comment not found.');
          }
          if (message.authorUserId !== commenter.id) {
            throw new FateRequestError('FORBIDDEN', 'You can only delete your own comments.');
          }
          const thread = await getCommentThread(ctx, message.threadId);
          const deleted = await createResolver({
            ctx,
            select,
            view: shareCommentMessageDataView,
          }).resolve(message);
          const now = new Date();
          const [, deletedThreads] = await ctx.db.batch([
            ctx.db.delete(shareCommentMessage).where(eq(shareCommentMessage.id, message.id)),
            ctx.db
              .delete(shareCommentThread)
              .where(
                and(
                  eq(shareCommentThread.id, thread.id),
                  sql`not exists (
                    select 1 from ${shareCommentMessage}
                    where ${shareCommentMessage.threadId} = ${thread.id}
                  )`,
                ),
              )
              .returning({ id: shareCommentThread.id }),
            ctx.db
              .update(shareCommentThread)
              .set({ updatedAt: now })
              .where(eq(shareCommentThread.id, thread.id)),
          ]);
          live.delete('ShareCommentMessage', message.id);
          if (deletedThreads.length > 0) {
            publishThreadDelete(thread);
          } else {
            live
              .connection('ShareCommentThread.messages', { id: thread.id })
              .deleteEdge('ShareCommentMessage', message.id);
            live.update('ShareCommentThread', thread.id, { changed: ['updatedAt'] });
          }
          return deleted;
        },
        type: 'ShareCommentMessage',
      },
      'shareComment.reply': {
        input: replyShareCommentInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof replyShareCommentInput>;
          select: Array<string>;
        }) => {
          const commenter = await requireAuthenticatedUser(ctx);
          const thread = await getCommentThread(ctx, input.threadId);
          if (thread.status === 'resolved') {
            throw new FateRequestError('BAD_REQUEST', 'Reopen this thread before replying.');
          }
          const now = new Date();
          const messageId = crypto.randomUUID();
          await ctx.db.batch([
            ctx.db.insert(shareCommentMessage).values({
              authorImage: commenter.image,
              authorName: commenter.name,
              authorUserId: commenter.id,
              authorUsername: getShareCommentAuthorUsername(commenter),
              body: input.body,
              createdAt: now,
              id: messageId,
              threadId: thread.id,
              updatedAt: now,
            }),
            ctx.db
              .update(shareCommentThread)
              .set({ updatedAt: now })
              .where(eq(shareCommentThread.id, thread.id)),
          ]);
          live
            .connection('ShareCommentThread.messages', { id: thread.id })
            .appendNode('ShareCommentMessage', messageId);
          live.update('ShareCommentThread', thread.id, { changed: ['updatedAt'] });
          return sources.resolveById({
            ctx,
            id: messageId,
            input: { select },
            view: shareCommentMessageDataView,
          });
        },
        type: 'ShareCommentMessage',
      },
      'shareComment.resolveThread': {
        input: resolveShareCommentThreadInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof resolveShareCommentThreadInput>;
          select: Array<string>;
        }) => {
          const commenter = await requireAuthenticatedUser(ctx);
          const thread = await getCommentThread(ctx, input.threadId);
          if ((await getThreadOwnerId(ctx, thread)) !== commenter.id) {
            throw new FateRequestError(
              'FORBIDDEN',
              'Only the person who shared this can resolve comments.',
            );
          }
          const now = new Date();
          await ctx.db
            .update(shareCommentThread)
            .set({
              resolvedAt: input.resolved ? now : null,
              status: input.resolved ? 'resolved' : 'open',
              updatedAt: now,
            })
            .where(eq(shareCommentThread.id, thread.id));
          live.update('ShareCommentThread', thread.id, {
            changed: ['resolvedAt', 'status', 'updatedAt'],
          });
          return sources.resolveById({
            ctx,
            id: thread.id,
            input: { select },
            view: shareCommentThreadDataView,
          });
        },
        type: 'ShareCommentThread',
      },
      'shareComment.updateMessage': {
        input: updateShareCommentInput,
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: z.infer<typeof updateShareCommentInput>;
          select: Array<string>;
        }) => {
          const commenter = await requireAuthenticatedUser(ctx);
          const [message] = await ctx.db
            .select()
            .from(shareCommentMessage)
            .where(eq(shareCommentMessage.id, input.messageId))
            .limit(1);
          if (!message) {
            throw new FateRequestError('NOT_FOUND', 'Comment not found.');
          }
          if (message.authorUserId !== commenter.id) {
            throw new FateRequestError('FORBIDDEN', 'You can only edit your own comments.');
          }
          const now = new Date();
          await ctx.db.batch([
            ctx.db
              .update(shareCommentMessage)
              .set({ body: input.body, updatedAt: now })
              .where(eq(shareCommentMessage.id, message.id)),
            ctx.db
              .update(shareCommentThread)
              .set({ updatedAt: now })
              .where(eq(shareCommentThread.id, message.threadId)),
          ]);
          live.update('ShareCommentMessage', message.id, { changed: ['body', 'updatedAt'] });
          live.update('ShareCommentThread', message.threadId, { changed: ['updatedAt'] });
          return sources.resolveById({
            ctx,
            id: message.id,
            input: { select },
            view: shareCommentMessageDataView,
          });
        },
        type: 'ShareCommentMessage',
      },
    },
    queries: {
      planBySlug: {
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: { args?: { slug: string } };
          select: Array<string>;
        }) => {
          const slug = input.args?.slug;
          if (!slug) {
            throw new FateRequestError('BAD_REQUEST', 'A plan slug is required.');
          }
          const [record] = await ctx.db
            .select({
              commentsImportedAt: plan.commentsImportedAt,
              id: plan.id,
              objectKey: plan.objectKey,
            })
            .from(plan)
            .where(eq(plan.slug, slug))
            .limit(1);
          if (!record) {
            return null;
          }
          if (
            select.some(
              (field) => field === 'commentThreads' || field.startsWith('commentThreads.'),
            )
          ) {
            await ensurePlanCommentsImported(ctx.db, ctx.env.WALKTHROUGH_BUCKET, record);
          }
          return sources.resolveById({
            ctx,
            id: record.id,
            input: { select },
            view: planDataView,
          });
        },
        type: 'Plan',
      },
      sharingStats: {
        resolve: async ({ ctx, select }: { ctx: SharingFateContext; select: Array<string> }) =>
          createResolver({
            ctx,
            select,
            view: shareStatsDataView,
          }).resolve(await fetchShareStats(ctx.db)),
        type: 'ShareStats',
      },
      uploadIntentByCode: {
        resolve: async ({
          ctx,
          input,
          select,
        }: {
          ctx: SharingFateContext;
          input: { args?: { code: string } };
          select: Array<string>;
        }) => {
          const code = input.args?.code;
          const secret = ctx.request.headers.get(uploadIntentSecretHeader);
          if (!code || !secret) {
            throw new FateRequestError('BAD_REQUEST', 'An upload code and secret are required.');
          }
          let [record] = await ctx.db
            .select()
            .from(uploadIntent)
            .where(eq(uploadIntent.code, code))
            .limit(1);

          const secretHash = await hashUploadIntentSecret(secret);
          if (!record) {
            const pending = await verifyUploadIntentSecret(ctx.env, code, secret);
            if (!pending) {
              throw new FateRequestError('NOT_FOUND', 'Upload intent not found.');
            }
            if (pending.expiresAt.getTime() < Date.now()) {
              throw new FateRequestError('BAD_REQUEST', 'This upload intent has expired.');
            }
            const commenter = await requireAuthenticatedUser(ctx);
            const now = new Date();
            await ctx.db
              .insert(uploadIntent)
              .values({
                claimedAt: now,
                code,
                expiresAt: pending.expiresAt,
                secretHash,
                sharedByUserId: commenter.id,
                status: 'claimed',
                updatedAt: now,
                uploadTokenHash: secretHash,
              })
              .onConflictDoNothing();
            [record] = await ctx.db
              .select()
              .from(uploadIntent)
              .where(eq(uploadIntent.code, code))
              .limit(1);
          }
          if (!record || record.secretHash !== secretHash) {
            throw new FateRequestError('NOT_FOUND', 'Upload intent not found.');
          }
          if (record.expiresAt.getTime() < Date.now() && record.status !== 'uploaded') {
            throw new FateRequestError('BAD_REQUEST', 'This upload intent has expired.');
          }
          if (record.status !== 'uploaded') {
            const commenter = await requireAuthenticatedUser(ctx);
            if (record.sharedByUserId && record.sharedByUserId !== commenter.id) {
              throw new FateRequestError(
                'FORBIDDEN',
                'This upload was authorized by another account.',
              );
            }
            if (record.status === 'pending') {
              const now = new Date();
              await ctx.db
                .update(uploadIntent)
                .set({
                  claimedAt: now,
                  sharedByUserId: commenter.id,
                  status: 'claimed',
                  updatedAt: now,
                  uploadTokenHash: record.secretHash,
                })
                .where(
                  and(
                    eq(uploadIntent.id, record.id),
                    eq(uploadIntent.status, 'pending'),
                    sql`${uploadIntent.sharedByUserId} is null`,
                  ),
                );
            }
          }
          return sources.resolveById({
            ctx,
            id: record.id,
            input: { args: input.args, select },
            view: uploadIntentDataView,
          });
        },
        type: 'UploadIntent',
      },
    },
    roots: SharingRoot,
    sources: allSources,
  });
};
