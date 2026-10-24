import { ClockCounterClockwiseIcon as ClockCounterClockwise } from '@phosphor-icons/react/ClockCounterClockwise';
import { CodeIcon as Code } from '@phosphor-icons/react/Code';
import { TreeStructureIcon as TreeStructure } from '@phosphor-icons/react/TreeStructure';
import type { PanelVisibility, ReviewPanel } from '../../lib/panel-layout.ts';

const panels = [
  { icon: ClockCounterClockwise, key: 'history', label: 'History' },
  { icon: TreeStructure, key: 'files', label: 'Files' },
  { icon: Code, key: 'diff', label: 'Diff' },
] as const;

export function PanelVisibilityControls({
  onToggle,
  visible,
}: {
  onToggle: (panel: ReviewPanel) => void;
  visible: PanelVisibility;
}) {
  return (
    <div aria-label="Visible panels" className="panel-visibility-controls" role="group">
      {panels.map(({ icon: Icon, key, label }) => {
        const title = `${visible[key] ? 'Hide' : 'Show'} ${label.toLowerCase()} panel`;
        return (
          <button
            aria-controls={`review-panel-${key}`}
            aria-label={title}
            aria-pressed={visible[key]}
            key={key}
            onClick={() => onToggle(key)}
            title={title}
            type="button"
          >
            <Icon aria-hidden size={16} weight="bold" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
