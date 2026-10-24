export type ReviewPanel = 'history' | 'files' | 'diff';
export type PanelVisibility = Record<ReviewPanel, boolean>;

const storageKey = 'codiff:panel-visibility';
const defaultVisibility: PanelVisibility = { diff: true, files: true, history: true };

export const readPanelVisibility = (): PanelVisibility => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!saved || typeof saved !== 'object') {
      return defaultVisibility;
    }
    const values = saved as Partial<PanelVisibility>;
    return {
      diff: typeof values.diff === 'boolean' ? values.diff : true,
      files: typeof values.files === 'boolean' ? values.files : true,
      history: typeof values.history === 'boolean' ? values.history : true,
    };
  } catch {
    return defaultVisibility;
  }
};

export const writePanelVisibility = (visibility: PanelVisibility) => {
  localStorage.setItem(storageKey, JSON.stringify(visibility));
};

export const getPanelColumns = (
  visible: PanelVisibility,
  historyWidth: number,
  filesWidth: number,
  position: 'left' | 'right',
): string => {
  const flexible = 'minmax(0, 1fr)';
  const columns = [
    visible.history
      ? visible.files || visible.diff
        ? `min(${historyWidth}px, ${visible.diff ? 30 : 60}vw)`
        : flexible
      : '0',
    '0',
    visible.files ? (visible.diff ? `min(${filesWidth}px, 30vw)` : flexible) : '0',
    '0',
    visible.diff || (!visible.history && !visible.files) ? flexible : '0',
  ];
  return (position === 'right' ? columns.reverse() : columns).join(' ');
};
