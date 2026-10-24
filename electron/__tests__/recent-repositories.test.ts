import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';

const { createRecentRepositories } = createRequire(import.meta.url)(
  '../recent-repositories.cjs',
) as {
  createRecentRepositories: (directory: string) => {
    list: () => Array<string>;
    remember: (root: string) => void;
  };
};

test('recent projects are deduplicated, ordered, bounded, and restored on restart', async () => {
  await using directory = await createTemporaryDirectory('codiff-recent-projects-');
  const history = createRecentRepositories(directory.path);
  for (let index = 0; index < 25; index += 1) {
    history.remember(`/repo-${index}`);
  }
  history.remember('/repo-8');
  const restored = createRecentRepositories(directory.path).list();
  expect(restored).toHaveLength(20);
  expect(restored.slice(0, 3)).toEqual(['/repo-8', '/repo-24', '/repo-23']);
  expect(restored.filter((path) => path === '/repo-8')).toHaveLength(1);
});
