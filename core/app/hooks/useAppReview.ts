import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { buildCommitModel } from '../../lib/commit.ts';
import { readProjectCommitDraft, writeProjectCommitDraft } from '../../lib/project-sessions.ts';
import { getSourceKey } from '../../lib/source.ts';
import type { RepositoryState, CommitRequest } from '../../types.ts';

export function useAppReview({
  state,
  stateRef,
}: {
  state: RepositoryState | null;
  stateRef: RefObject<RepositoryState | null>;
}) {
  const [mainMode, setMainMode] = useState<'commit' | 'review'>('review');
  const mainModeRef = useRef(mainMode);
  useEffect(() => {
    mainModeRef.current = mainMode;
  }, [mainMode]);
  const commitModel = useMemo(() => buildCommitModel(state?.files ?? []), [state?.files]);
  const [commitSubject, setCommitSubject] = useState('');
  const [commitBody, setCommitBody] = useState('');
  const [commitSelected, setCommitSelected] = useState<ReadonlySet<string>>(new Set());
  const previousPaths = useRef(new Set<string>());
  const resetKey = state ? `${state.root}:${getSourceKey(state.source)}` : '';
  const previousKey = useRef(resetKey);
  const draftRestored = useRef(false);
  useEffect(() => {
    const paths = new Set(commitModel.files.map((file) => file.path));
    if (previousKey.current !== resetKey || (!draftRestored.current && resetKey)) {
      const saved =
        !draftRestored.current && state?.source.type === 'working-tree'
          ? readProjectCommitDraft(state.root)
          : null;
      if (resetKey) {
        draftRestored.current = true;
      }
      previousKey.current = resetKey;
      setCommitSubject(saved?.subject ?? '');
      setCommitBody(saved?.body ?? '');
      setCommitSelected(
        saved ? new Set([...paths].filter((path) => !saved.excluded.includes(path))) : paths,
      );
    } else {
      const oldPaths = previousPaths.current;
      setCommitSelected(
        (current) => new Set([...paths].filter((path) => current.has(path) || !oldPaths.has(path))),
      );
    }
    previousPaths.current = paths;
  }, [commitModel, resetKey, state]);

  useEffect(() => {
    const saveDraft = () => {
      if (state?.source.type === 'working-tree') {
        writeProjectCommitDraft(state.root, {
          body: commitBody,
          excluded: commitModel.files
            .map((file) => file.path)
            .filter((path) => !commitSelected.has(path)),
          subject: commitSubject,
        });
      }
    };
    window.addEventListener('beforeunload', saveDraft);
    return () => window.removeEventListener('beforeunload', saveDraft);
  }, [commitBody, commitModel, commitSelected, commitSubject, state]);
  const toggleCommitGroup = useCallback((paths: ReadonlyArray<string>) => {
    setCommitSelected((current) => {
      const next = new Set(current);
      const remove = paths.every((path) => current.has(path));
      for (const path of paths) {
        if (remove) {
          next.delete(path);
        } else {
          next.add(path);
        }
      }
      return next;
    });
  }, []);
  const toggleCommitFile = useCallback(
    (path: string) => toggleCommitGroup([path]),
    [toggleCommitGroup],
  );
  const openCommitView = useCallback(() => {
    if (stateRef.current?.source.type !== 'working-tree' || !stateRef.current.files.length) {
      return;
    }
    setMainMode('commit');
  }, [stateRef]);
  const closeCommitView = useCallback(() => {
    setMainMode('review');
  }, []);
  const commitChanges = useCallback(
    (request: CommitRequest) =>
      window.codiff.createCommit({
        ...request,
        source: stateRef.current?.source ?? request.source,
      }),
    [stateRef],
  );
  const subscribeToCommitOutput = useCallback(
    (callback: (chunk: string) => void) => window.codiff.onCommitOutput(callback),
    [],
  );
  return {
    closeCommitView,
    commitChanges,
    commitDraft: {
      commitBody,
      commitSelected,
      commitSubject,
      setCommitBody,
      setCommitSubject,
      toggleCommitFile,
      toggleCommitGroup,
    },
    commitModel,
    mainModeRef,
    openCommitView,
    setMainMode,
    showCommitView:
      mainMode === 'commit' && state?.source.type === 'working-tree' && state.files.length > 0,
    subscribeToCommitOutput,
  };
}
