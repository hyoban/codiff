import { useEffect, useRef, useState } from 'react';

export const useRepositoryAutoRefresh = (enabled: boolean, refresh: () => Promise<void>) => {
  const [requestedVersion, setRequestedVersion] = useState(0);
  const [completedVersion, setCompletedVersion] = useState(0);
  const refreshingRef = useRef(false);

  useEffect(
    () => window.codiff.onRepositoryChanged(() => setRequestedVersion((version) => version + 1)),
    [],
  );

  useEffect(() => {
    if (!enabled || refreshingRef.current || requestedVersion === completedVersion) {
      return;
    }

    // Coalesce notifications during a refresh into one follow-up request. Keep
    // pending changes until the initial load or source transition has finished.
    refreshingRef.current = true;
    void refresh().finally(() => {
      refreshingRef.current = false;
      setCompletedVersion(requestedVersion);
    });
  }, [completedVersion, enabled, refresh, requestedVersion]);
};
