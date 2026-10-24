const SIDEBAR_WIDTH_STORAGE_KEY = 'codiff:sidebar-width';
const HISTORY_WIDTH_STORAGE_KEY = 'codiff:history-width';

export const SIDEBAR_COLLAPSE_THRESHOLD = 80;
export const SIDEBAR_DEFAULT_WIDTH = 292;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_MIN_WIDTH = 220;

type SidebarWidthStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

export const readSidebarWidth = (storage: SidebarWidthStorage = localStorage): number => {
  const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
};

export const writeSidebarWidth = (width: number, storage: SidebarWidthStorage = localStorage) => {
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
};

export const readHistoryWidth = (storage: SidebarWidthStorage = localStorage): number => {
  const raw = storage.getItem(HISTORY_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : 252;
};

export const writeHistoryWidth = (width: number, storage: SidebarWidthStorage = localStorage) => {
  storage.setItem(HISTORY_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
};
