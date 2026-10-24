import type { ChangedFile } from '../types.ts';
export type CommitFile = {
  added: number;
  deleted: number;
  itemId: string;
  name: string;
  path: string;
};
export type CommitGroup = { files: ReadonlyArray<CommitFile>; id: string; title: string };
export type CommitModel = { files: ReadonlyArray<CommitFile>; groups: ReadonlyArray<CommitGroup> };
const fileBaseName = (path: string) => path.split('/').pop() ?? path;

const countPatchLines = (patch: string): { added: number; deleted: number } => {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      added += 1;
    } else if (line.startsWith('-')) {
      deleted += 1;
    }
  }

  return { added, deleted };
};

const getChangedFileLineCount = (file: ChangedFile): { added: number; deleted: number } =>
  file.sections.reduce(
    (totals, section) => {
      const count = countPatchLines(section.patch || '');
      return {
        added: totals.added + count.added,
        deleted: totals.deleted + count.deleted,
      };
    },
    { added: 0, deleted: 0 },
  );

export const buildCommitModel = (changedFiles: ReadonlyArray<ChangedFile>): CommitModel => {
  const files = changedFiles.map((changedFile) => {
    const totals = getChangedFileLineCount(changedFile);
    return {
      added: totals.added,
      deleted: totals.deleted,
      itemId: `__file:${changedFile.path}`,
      name: fileBaseName(changedFile.path),
      path: changedFile.path,
    };
  });

  return {
    files,
    groups:
      files.length > 0
        ? [
            {
              files,
              id: '__changed',
              title: 'Changed files',
            },
          ]
        : [],
  };
};
