import type { SourceSession } from './app-types.ts';

const key = (root: string) => `codiff:project-session:${root}`;

export const readProjectSessions = (root: string): Map<string, SourceSession> => {
  try {
    const entries = JSON.parse(sessionStorage.getItem(key(root)) ?? '[]') as Array<
      [
        string,
        Omit<SourceSession, 'collapsed' | 'expandedReviewKeys'> & {
          collapsed: Array<string>;
          expandedReviewKeys: Array<string>;
        },
      ]
    >;
    return new Map(
      entries.map(([source, session]) => [
        source,
        {
          ...session,
          collapsed: new Set(session.collapsed),
          expandedReviewKeys: new Set(session.expandedReviewKeys),
        },
      ]),
    );
  } catch {
    return new Map();
  }
};

export const writeProjectSessions = (
  root: string,
  sessions: ReadonlyMap<string, SourceSession>,
) => {
  sessionStorage.setItem(
    key(root),
    JSON.stringify(
      [...sessions].map(([source, session]) => [
        source,
        {
          ...session,
          collapsed: [...session.collapsed],
          expandedReviewKeys: [...session.expandedReviewKeys],
        },
      ]),
    ),
  );
};

export type SavedCommitDraft = { body: string; excluded: Array<string>; subject: string };
const draftKey = (root: string) => `codiff:project-commit-draft:${root}`;
export const readProjectCommitDraft = (root: string): SavedCommitDraft | null => {
  try {
    const draft = JSON.parse(
      sessionStorage.getItem(draftKey(root)) ?? 'null',
    ) as SavedCommitDraft | null;
    return draft &&
      typeof draft.subject === 'string' &&
      typeof draft.body === 'string' &&
      Array.isArray(draft.excluded)
      ? draft
      : null;
  } catch {
    return null;
  }
};
export const writeProjectCommitDraft = (root: string, draft: SavedCommitDraft) => {
  sessionStorage.setItem(draftKey(root), JSON.stringify(draft));
};
