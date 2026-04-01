import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  clearSeedManifest,
  rocketChatMessagePermalinkFrom,
  stripLeadingRocketChatQuotePlaceholders,
  writeSeedManifestAtomically,
} from './index';

describe('stripLeadingRocketChatQuotePlaceholders', () => {
  test('preserves ordinary message bodies', () => {
    expect(stripLeadingRocketChatQuotePlaceholders('[betterchat] plain body')).toBe('[betterchat] plain body');
  });

  test('removes a single leading Rocket.Chat quote placeholder line', () => {
    expect(
      stripLeadingRocketChatQuotePlaceholders(
        '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-1)\n[betterchat] quoted body',
      ),
    ).toBe('[betterchat] quoted body');
  });

  test('removes multiple leading Rocket.Chat quote placeholder lines but leaves later markdown intact', () => {
    expect(
      stripLeadingRocketChatQuotePlaceholders(
        [
          '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-1)',
          '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-2)',
          '',
          '[betterchat] quoted body',
          '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=not-a-placeholder-anymore)',
        ].join('\n'),
      ),
    ).toBe('[betterchat] quoted body\n[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=not-a-placeholder-anymore)');
  });

  test('supports the same attachment-count bound used by the backend normalizer', () => {
    expect(
      stripLeadingRocketChatQuotePlaceholders(
        [
          '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-1)',
          '[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-2)',
          '[betterchat] quoted body',
        ].join('\n'),
        1,
      ),
    ).toBe('[ ](http://127.0.0.1:3100/channel/betterchat-public?msg=parent-2)\n[betterchat] quoted body');
  });
});

describe('seed manifest helpers', () => {
  test('builds Rocket.Chat message permalinks for channels, groups, and directs', () => {
    expect(
      rocketChatMessagePermalinkFrom(
        'http://127.0.0.1:3100',
        { kind: 'channel', roomId: 'room-1', name: 'betterchat-public' },
        'message-1',
      ),
    ).toBe('http://127.0.0.1:3100/channel/betterchat-public?msg=message-1');
    expect(
      rocketChatMessagePermalinkFrom(
        'http://127.0.0.1:3100',
        { kind: 'group', roomId: 'room-2', name: 'betterchat-private' },
        'message-2',
      ),
    ).toBe('http://127.0.0.1:3100/group/betterchat-private?msg=message-2');
    expect(
      rocketChatMessagePermalinkFrom(
        'http://127.0.0.1:3100',
        { kind: 'dm', roomId: 'room-3' },
        'message-3',
      ),
    ).toBe('http://127.0.0.1:3100/direct/room-3?msg=message-3');
  });

  test('writes the seed manifest atomically', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'betterchat-seed-manifest-'));
    const manifestPath = join(directory, 'manifest.json');

    await writeSeedManifestAtomically(
      {
        version: 1,
        seedRunTag: 'seed-run',
        workspace: {
          siteName: 'BetterChat Test Workspace',
        },
        users: {},
        rooms: {},
        messages: {},
      },
      manifestPath,
    );

    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({
      version: 1,
      seedRunTag: 'seed-run',
      workspace: {
        siteName: 'BetterChat Test Workspace',
      },
      users: {},
      rooms: {},
      messages: {},
    });
  });

  test('clears an existing seed manifest without failing when it is already absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'betterchat-seed-manifest-'));
    const manifestPath = join(directory, 'manifest.json');

    await writeSeedManifestAtomically(
      {
        version: 1,
        seedRunTag: 'seed-run',
        workspace: {
          siteName: 'BetterChat Test Workspace',
        },
        users: {},
        rooms: {},
        messages: {},
      },
      manifestPath,
    );
    await clearSeedManifest(manifestPath);
    await clearSeedManifest(manifestPath);

    expect(() => readFileSync(manifestPath, 'utf8')).toThrow();
  });
});
