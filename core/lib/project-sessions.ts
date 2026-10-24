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
