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
  repository,
  repositoryTooltip,
  sourceMenu,
}: {
  actions?: ReactNode;
  center?: ReactNode;
  context?: ReactNode;
  leading?: ReactNode;
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
        <div className="review-top-bar-repository-slot" title={repositoryTooltip}>
          {repository}
        </div>
      </div>
      {modes ? (
        <ReviewModeControl mode={mode} modes={modes} onModeChange={onModeChange} />
      ) : (
        <div className="review-top-bar-center">{center}</div>
      )}
      <div className="review-top-bar-right">
        {context ? <div className="review-top-bar-context">{context}</div> : null}
        {actions ? <div className="review-top-bar-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
