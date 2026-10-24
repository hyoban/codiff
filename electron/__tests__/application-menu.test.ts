import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vite-plus/test';

type MenuItem = { label?: string; role?: string; submenu?: Array<MenuItem> };
const source = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
const menuSource = source.slice(
  source.indexOf('const buildApplicationMenu ='),
  source.indexOf('let copyingPendingCommentsBeforeQuit ='),
);
const flatten = (items: Array<MenuItem>): Array<MenuItem> =>
  items.flatMap((item) => [item, ...flatten(item.submenu ?? [])]);

test.each(['darwin', 'linux', 'win32'])(
  'keeps ordinary application commands without AI menus on %s',
  (platform) => {
    const menu = runInNewContext(`${menuSource}\nbuildApplicationMenu();`, {
      Menu: { buildFromTemplate: (items: Array<MenuItem>) => items },
      config: { settings: {} },
      decreaseCodeFontSize: vi.fn(),
      increaseCodeFontSize: vi.fn(),
      process: { platform },
      resetCodeFontSize: vi.fn(),
    }) as Array<MenuItem>;
    const items = flatten(menu);
    const labels = items.map(({ label }) => label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'File',
        'Edit',
        'View',
        'Open Config File...',
        'Install Terminal Helper',
      ]),
    );
    for (const label of [
      'Agent',
      'Model',
      'Reasoning Effort',
      'Install Skill',
      'Check for Updates…',
    ]) {
      expect(labels).not.toContain(label);
    }
    expect(items.some(({ role }) => role === 'quit')).toBe(true);
    if (platform === 'darwin') {
      expect(menu[0]?.label).toBe('Codiff');
      expect(items.some(({ role }) => role === 'about')).toBe(true);
    }
  },
);
