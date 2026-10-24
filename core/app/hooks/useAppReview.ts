import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SidebarMode } from '../../lib/app-types.ts';
import { buildCommitModel } from '../../lib/commit.ts';
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
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('tree');
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
  useEffect(() => {
    const paths = new Set(commitModel.files.map((file) => file.path));
    if (previousKey.current !== resetKey) {
      previousKey.current = resetKey;
      setCommitSubject('');
      setCommitBody('');
      setCommitSelected(paths);
    } else {
      const oldPaths = previousPaths.current;
      setCommitSelected(
        (current) => new Set([...paths].filter((path) => current.has(path) || !oldPaths.has(path))),
      );
    }
    previousPaths.current = paths;
  }, [commitModel, resetKey]);
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
  const changeSidebarMode = useCallback((mode: SidebarMode) => {
    setMainMode('review');
    setSidebarMode(mode);
  }, []);
  const openCommitView = useCallback(() => {
    if (stateRef.current?.source.type !== 'working-tree' || !stateRef.current.files.length) {
      return;
    }
    setSidebarMode('tree');
    setMainMode('commit');
  }, [stateRef]);
  const closeCommitView = useCallback(() => {
    setSidebarMode('tree');
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
    changeSidebarMode,
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
    setSidebarMode,
    showCommitView:
      mainMode === 'commit' && state?.source.type === 'working-tree' && state.files.length > 0,
    sidebarMode,
    subscribeToCommitOutput,
  };
}
