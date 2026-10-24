import { createRequire } from 'node:module';
import { describe, expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);

const { normalizeGitLabReviewComment, parseGitLabMergeRequestUrl } =
  require('../../electron/git-state/merge-request.cjs') as {
    normalizeGitLabReviewComment: (
      note: Record<string, unknown>,
      url: string,
    ) => Record<string, unknown> | null;
    parseGitLabMergeRequestUrl: (url: string) => Record<string, unknown>;
  };

describe('GitLab merge requests', () => {
  test('parses arbitrary hosts and nested project paths', () => {
    expect(
      parseGitLabMergeRequestUrl(
        'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
      ),
    ).toMatchObject({
      host: 'gitlab.example.com',
      number: 23,
      projectPath: 'group/subgroup/project',
      provider: 'gitlab',
    });
  });

  test('canonicalizes merge request URLs copied from a review tab', () => {
    for (const value of [
      'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/diffs#note_991',
      'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23/commits',
      'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23?commit_id=0f1e2d3c',
      'https://gitlab.example.com/group/subgroup/project/merge_requests/23',
      'gitlab.example.com/group/subgroup/project/-/merge_requests/23/diffs',
    ]) {
      expect(parseGitLabMergeRequestUrl(value)).toMatchObject({
        host: 'gitlab.example.com',
        number: 23,
        projectPath: 'group/subgroup/project',
        provider: 'gitlab',
        url: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/23',
      });
    }
  });

  test('normalizes GitLab diff notes for the renderer', () => {
    expect(
      normalizeGitLabReviewComment(
        {
          author: { username: 'reviewer' },
          body: 'Please change this.',
          created_at: '2026-06-17T00:00:00Z',
          id: 44,
          position: {
            new_line: 12,
            new_path: 'src/a.ts',
            old_path: 'src/a.ts',
          },
        },
        'https://gitlab.example.com/group/project/-/merge_requests/23',
      ),
    ).toMatchObject({
      author: { login: 'reviewer' },
      body: 'Please change this.',
      filePath: 'src/a.ts',
      id: 'gitlab:44',
      lineNumber: 12,
      side: 'additions',
      url: 'https://gitlab.example.com/group/project/-/merge_requests/23#note_44',
    });
  });

  test('normalizes file-level GitLab notes without line metadata', () => {
    expect(
      normalizeGitLabReviewComment(
        {
          author: { username: 'reviewer' },
          body: 'Please review the file structure.',
          created_at: '2026-07-08T00:00:00Z',
          id: 45,
          position: {
            new_path: 'src/a.ts',
            old_path: 'src/a.ts',
            position_type: 'file',
          },
        },
        'https://gitlab.example.com/group/project/-/merge_requests/23',
      ),
    ).toMatchObject({
      anchor: 'file',
      author: { login: 'reviewer' },
      body: 'Please review the file structure.',
      filePath: 'src/a.ts',
      id: 'gitlab:45',
      url: 'https://gitlab.example.com/group/project/-/merge_requests/23#note_45',
    });
  });
});
