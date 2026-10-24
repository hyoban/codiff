/** @vitest-environment jsdom */
import { expect, test } from 'vite-plus/test';
import { readProjectSessions, writeProjectSessions } from '../lib/project-sessions.ts';

test('project sessions retain review state and drafts without leaking between projects', () => {
  sessionStorage.clear();
  const session = {
    collapsed: new Set(['a.ts']),
    expandedReviewKeys: new Set(['b.ts']),
    reviewComments: [],
    selectedPath: 'b.ts',
    viewed: { 'a.ts': 'fingerprint' },
  };
  writeProjectSessions('/first', new Map([['working-tree', session]]));

  expect(readProjectSessions('/first').get('working-tree')).toEqual(session);
  expect(readProjectSessions('/second').size).toBe(0);
});
