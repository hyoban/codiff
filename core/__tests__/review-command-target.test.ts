import { expect, test } from 'vite-plus/test';
import {
  createReviewCommandTarget,
  resolveReviewCommandTarget,
} from '../lib/review-command-target.ts';
import type { ChangedFile, ReviewSource } from '../types.ts';

const file = (path: string): ChangedFile => ({
  fingerprint: `${path}:1`,
  path,
  sections: [
    {
      binary: false,
      id: `${path}:unstaged`,
      kind: 'unstaged',
      patch: '',
    },
  ],
  status: 'modified',
});

test('review command target ignores stale active target from another source', () => {
  const selectedFile = file('src/first.ts');
  const currentSource = { ref: 'HEAD', type: 'commit' } satisfies ReviewSource;
  const staleSource = { type: 'working-tree' } satisfies ReviewSource;

  const target = resolveReviewCommandTarget({
    activeTarget: createReviewCommandTarget(staleSource, file('src/stale.ts')),
    files: [selectedFile],
    selectedPath: selectedFile.path,
    source: currentSource,
    useActiveTarget: true,
  });

  expect(target?.file.path).toBe(selectedFile.path);
  expect(target?.sourceKey).toBe('commit:HEAD');
});
