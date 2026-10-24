import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import type { ReactNode } from 'react';
import { ReviewModeControl, type ReviewModeItem } from './ReviewModeControl.tsx';

export function ReviewTopBar<Mode extends string>({
  actions,
  center,
  context,
  leading,
  mode,
  modes,
  onModeChange,
  onSwitchRepository,
  repository,
  repositoryTooltip,
  sourceMenu,
}: {
  actions?: ReactNode;
  center?: ReactNode;
  context?: ReactNode;
  leading?: ReactNode;
  onSwitchRepository?: () => void;
  repository: ReactNode;
  repositoryTooltip?: string;
  sourceMenu?: ReactNode;
} & (
  | {
      mode: Mode;
      modes: ReadonlyArray<ReviewModeItem<Mode>>;
      onModeChange: (mode: Mode) => void;
    }
  | { mode?: undefined; modes?: undefined; onModeChange?: undefined }
)) {
  return (
    <header className="review-top-bar workspace-top-bar">
      <div className="review-top-bar-left">
        {leading}
        {sourceMenu}
        {modes ? (
          <ReviewModeControl mode={mode} modes={modes} onModeChange={onModeChange} />
        ) : (
          center
        )}
      </div>
      <div className="review-top-bar-center">
        <button
          aria-haspopup="menu"
          aria-label="Switch project"
          className="review-top-bar-repository-slot repository-switcher"
          onClick={onSwitchRepository}
          title={repositoryTooltip}
          type="button"
        >
          {repository}
          <CaretDown aria-hidden className="repository-switcher-chevron" size={14} weight="bold" />
        </button>
      </div>
      <div className="review-top-bar-right">
        {context ? <div className="review-top-bar-context">{context}</div> : null}
        {actions ? <div className="review-top-bar-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
