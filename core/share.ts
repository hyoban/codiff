import {
  array,
  check,
  type InferOutput,
  integer,
  literal,
  looseObject,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  parse,
  picklist,
  pipe,
  safeParse,
  string,
  union,
} from 'valibot';

const maxDocumentLength = 2 * 1024 * 1024;
const maxCommentLength = 128 * 1024;
const maxAnchorTextLength = 64 * 1024;

const boundedString = (maximum: number) => pipe(string(), maxLength(maximum));
const nonEmptyString = (maximum: number) => pipe(string(), minLength(1), maxLength(maximum));
const timestamp = pipe(
  nonEmptyString(64),
  check((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp.'),
);
const index = pipe(number(), integer(), minValue(0), maxValue(1_000_000));

const authorSchema = looseObject({
  avatarUrl: optional(boundedString(2048)),
  email: optional(boundedString(320)),
  id: nonEmptyString(200),
  name: nonEmptyString(200),
  username: optional(boundedString(200)),
});

const blockSchema = looseObject({
  fingerprint: nonEmptyString(256),
  path: pipe(array(index), maxLength(64)),
  runtimeKey: optional(boundedString(256)),
  text: boundedString(maxAnchorTextLength),
  type: nonEmptyString(64),
});

const blockAnchorSchema = looseObject({
  block: blockSchema,
  kind: literal('block'),
  version: literal(1),
});

const textAnchorSchema = pipe(
  looseObject({
    block: blockSchema,
    kind: literal('text'),
    quote: looseObject({
      end: index,
      exact: boundedString(maxAnchorTextLength),
      prefix: boundedString(1024),
      start: index,
      suffix: boundedString(1024),
    }),
    version: literal(1),
  }),
  check(({ quote }) => quote.end >= quote.start, 'Invalid quote range.'),
);

const messageSchema = looseObject({
  author: authorSchema,
  body: boundedString(maxCommentLength),
  createdAt: timestamp,
  id: nonEmptyString(200),
  updatedAt: timestamp,
});

const threadSchema = looseObject({
  anchor: union([blockAnchorSchema, textAnchorSchema]),
  createdAt: timestamp,
  createdBy: authorSchema,
  id: nonEmptyString(200),
  messages: pipe(
    array(messageSchema),
    minLength(1),
    maxLength(100),
    check(
      (messages) => new Set(messages.map(({ id }) => id)).size === messages.length,
      'Duplicate message ID.',
    ),
  ),
  status: picklist(['open', 'resolved']),
  updatedAt: timestamp,
});

export const planShareManifestV1Schema = looseObject({
  codiffVersion: nonEmptyString(100),
  document: looseObject({
    content: boundedString(maxDocumentLength),
    name: pipe(
      nonEmptyString(300),
      check(
        (value) => !value.includes('/') && !value.includes('\\') && /\.md$/i.test(value),
        'Invalid plan file name.',
      ),
    ),
    title: nonEmptyString(300),
  }),
  exportedAt: timestamp,
  kind: literal('codiff-plan-share'),
  preferences: looseObject({
    theme: picklist(['dark', 'light', 'system']),
  }),
  review: looseObject({
    threads: pipe(
      array(threadSchema),
      maxLength(1000),
      check(
        (threads) => new Set(threads.map(({ id }) => id)).size === threads.length,
        'Duplicate thread ID.',
      ),
    ),
    version: literal(1),
  }),

  version: literal(1),
});

const uploaderSchema = looseObject({
  email: optional(boundedString(320)),
  name: optional(boundedString(200)),
});

const planShareUploadEnvelopeSchema = looseObject({
  snapshot: planShareManifestV1Schema,
  uploader: optional(uploaderSchema),
});

export type PlanShareManifestV1 = InferOutput<typeof planShareManifestV1Schema>;
export type ShareUploader = InferOutput<typeof uploaderSchema>;

export const parsePlanShareManifest = (value: unknown): PlanShareManifestV1 =>
  parse(planShareManifestV1Schema, value);

export const parsePlanShareUpload = (
  value: unknown,
): { snapshot: PlanShareManifestV1; uploader?: ShareUploader } => {
  const envelope = safeParse(planShareUploadEnvelopeSchema, value);
  if (envelope.success) {
    return {
      snapshot: envelope.output.snapshot,
      ...(envelope.output.uploader ? { uploader: envelope.output.uploader } : {}),
    };
  }
  return { snapshot: parsePlanShareManifest(value) };
};
