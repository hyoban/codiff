import { createLiveEventBus } from '@nkzw/fate/server';
import { expect, test } from 'vite-plus/test';
import { createSharingFateServer } from './fate.ts';

const fateServer = createSharingFateServer({
  live: createLiveEventBus(),
  providerLabel: 'GitHub',
});

test('enables live subscriptions for every shared service entity', () => {
  expect(fateServer.manifest.live).toEqual(fateServer.manifest.types);
  expect(Object.keys(fateServer.manifest.live)).toEqual([
    'Plan',
    'ShareCommentMessage',
    'ShareCommentThread',
    'ShareStats',
    'ShareStatsDay',
    'UploadIntent',
  ]);
});
