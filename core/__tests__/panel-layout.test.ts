/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, test } from 'vite-plus/test';
import { getPanelColumns, readPanelVisibility, writePanelVisibility } from '../lib/panel-layout.ts';

beforeEach(() => localStorage.clear());

test('invalid saved visibility falls back without hiding panels', () => {
  localStorage.setItem('codiff:panel-visibility', '{');
  expect(readPanelVisibility()).toEqual({ diff: true, files: true, history: true });
  localStorage.setItem('codiff:panel-visibility', '{"files":false,"diff":"false"}');
  expect(readPanelVisibility()).toEqual({ diff: true, files: false, history: true });
  writePanelVisibility({ diff: false, files: true, history: false });
  expect(readPanelVisibility()).toEqual({ diff: false, files: true, history: false });
});

test.each([
  [true, true, true, 'min(252px, 30vw)', 'min(292px, 30vw)', 'minmax(0, 1fr)'],
  [false, true, true, '0', 'min(292px, 30vw)', 'minmax(0, 1fr)'],
  [true, false, true, 'min(252px, 30vw)', '0', 'minmax(0, 1fr)'],
  [false, false, true, '0', '0', 'minmax(0, 1fr)'],
  [true, true, false, 'min(252px, 60vw)', 'minmax(0, 1fr)', '0'],
  [true, false, false, 'minmax(0, 1fr)', '0', '0'],
  [false, true, false, '0', 'minmax(0, 1fr)', '0'],
  [false, false, false, '0', '0', 'minmax(0, 1fr)'],
] as const)(
  'layout fills available space with history=%s files=%s diff=%s',
  (history, files, diff, historyTrack, filesTrack, diffTrack) => {
    const visible = { diff, files, history };
    expect(getPanelColumns(visible, 252, 292, 'left')).toBe(
      `${historyTrack} 0 ${filesTrack} 0 ${diffTrack}`,
    );
    expect(getPanelColumns(visible, 252, 292, 'right')).toBe(
      `${diffTrack} 0 ${filesTrack} 0 ${historyTrack}`,
    );
  },
);
