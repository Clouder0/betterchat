import { describe, expect, test } from 'bun:test';

import { authorizationSnapshotFrom } from './authorization';
import {
  AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID,
  THREADS_ENABLED_SETTING_ID,
  conversationCapabilitiesFrom,
  conversationMessageActionsFrom,
  workspaceBootstrapCapabilitiesFrom,
  workspaceWritesEnabledFrom,
} from './capabilities';
import type { UpstreamMessage, UpstreamPermissionDefinition, UpstreamRoom, UpstreamSetting } from './upstream';

const settings = (values: Record<string, unknown>): UpstreamSetting[] =>
  Object.entries(values).map(([_id, value]) => ({ _id, value }));

const permissions = (values: Record<string, string[]>): UpstreamPermissionDefinition[] =>
  Object.entries(values).map(([_id, roles]) => ({ _id, roles }));

const authorization = ({
  globalRoles = ['user'],
  roomRoles = [],
  permissionsById = {},
}: {
  globalRoles?: string[];
  roomRoles?: string[];
  permissionsById?: Record<string, string[]>;
} = {}) =>
  authorizationSnapshotFrom(
    { roles: globalRoles },
    { roles: roomRoles } as never,
    permissions(permissionsById),
  );

const conversationRoom = (values: Partial<UpstreamRoom> = {}) => ({
  t: 'c',
  ...values,
});

const message = (values: Partial<UpstreamMessage> = {}): UpstreamMessage => ({
  _id: 'message-1',
  rid: 'room-1',
  msg: 'hello',
  ts: '2026-03-27T10:00:00.000Z',
  u: {
    _id: 'alice-id',
    username: 'alice',
    name: 'Alice Example',
  },
  ...values,
});

describe('capabilities', () => {
  test('treats the workspace as writable when the air-gapped restriction setting is absent or in warning mode', () => {
    expect(workspaceWritesEnabledFrom(settings({}))).toBe(true);
    expect(
      workspaceWritesEnabledFrom(
        settings({
          [AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID]: 3,
        }),
      ),
    ).toBe(true);
  });

  test('disables write capabilities when Rocket.Chat reports restriction phase', () => {
    const restrictedSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
      [AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID]: 0,
    });

    expect(workspaceBootstrapCapabilitiesFrom(restrictedSettings)).toEqual({
      canSendMessages: false,
      canUploadImages: false,
      canUploadImagesInDirectMessages: false,
      realtimeEnabled: true,
    });
    expect(conversationCapabilitiesFrom({ t: 'c' }, restrictedSettings)).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
    });
    expect(conversationCapabilitiesFrom({ t: 'd' }, restrictedSettings)).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
    });
  });

  test('keeps direct-message uploads independent from global room uploads', () => {
    const mixedUploadSettings = settings({
      FileUpload_Enabled: false,
      FileUpload_Enabled_Direct: true,
      [AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID]: -1,
    });

    expect(workspaceBootstrapCapabilitiesFrom(mixedUploadSettings)).toEqual({
      canSendMessages: true,
      canUploadImages: false,
      canUploadImagesInDirectMessages: true,
      realtimeEnabled: true,
    });
    expect(conversationCapabilitiesFrom({ t: 'c' }, mixedUploadSettings)).toMatchObject({
      messageMutations: {
        conversation: true,
        conversationReply: true,
        thread: true,
        threadEchoToConversation: true,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
    });
    expect(conversationCapabilitiesFrom({ t: 'd' }, mixedUploadSettings)).toMatchObject({
      messageMutations: {
        conversation: true,
        conversationReply: true,
        thread: true,
        threadEchoToConversation: true,
      },
      mediaMutations: {
        conversation: true,
        conversationReply: true,
        thread: true,
        threadEchoToConversation: false,
      },
    });
  });

  test('disables send, edit, upload, delete, and reactions in readonly rooms for ordinary members', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ ro: true, reactWhenReadOnly: false }),
        writableSettings,
        { currentUsername: 'alice' },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      react: false,
    });
  });

  test('keeps reactions enabled when Rocket.Chat allows reactions in readonly rooms', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ ro: true, reactWhenReadOnly: true }),
        writableSettings,
        { currentUsername: 'alice' },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      react: true,
    });
  });

  test('honors readonly override and room/global permissions for privileged users', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
      [THREADS_ENABLED_SETTING_ID]: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ ro: true, reactWhenReadOnly: false }),
        writableSettings,
        {
          authorization: authorization({
            globalRoles: ['admin'],
            roomRoles: ['owner'],
            permissionsById: {
              'post-readonly': ['admin'],
              'edit-message': ['admin'],
              'delete-message': ['owner'],
            },
          }),
          currentUsername: 'admin',
        },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: true,
        conversationReply: true,
        thread: true,
        threadEchoToConversation: true,
      },
      mediaMutations: {
        conversation: true,
        conversationReply: true,
        thread: true,
        threadEchoToConversation: false,
      },
      react: true,
    });
  });

  test('disables send, edit, upload, and reactions for muted members', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ muted: ['alice'] }),
        writableSettings,
        { currentUsername: 'alice' },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      react: false,
    });
  });

  test('disables send, edit, and upload for blocked direct-message memberships', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ t: 'd' }),
        writableSettings,
        {
          currentUsername: 'alice',
          subscription: { blocked: true },
        },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      react: true,
    });
  });

  test('disables send, edit, and upload for archived conversations', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ archived: true }),
        writableSettings,
        { currentUsername: 'alice' },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom({ t: 'd' }),
        writableSettings,
        {
          currentUsername: 'alice',
          subscription: { archived: true },
        },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: false,
        conversationReply: false,
        thread: false,
        threadEchoToConversation: false,
      },
    });
  });

  test('disables thread capabilities when Rocket.Chat threads are disabled globally', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
      [THREADS_ENABLED_SETTING_ID]: false,
    });

    expect(
      conversationCapabilitiesFrom(
        conversationRoom(),
        writableSettings,
        {
          currentUsername: 'alice',
        },
      ),
    ).toMatchObject({
      messageMutations: {
        conversation: true,
        conversationReply: true,
        thread: false,
        threadEchoToConversation: false,
      },
      mediaMutations: {
        conversation: true,
        conversationReply: true,
        thread: false,
        threadEchoToConversation: false,
      },
    });
  });

  test('keeps archived-room edit and delete actions aligned with upstream message rules', () => {
    const writableSettings = settings({
      FileUpload_Enabled: true,
      FileUpload_Enabled_Direct: true,
      Message_AllowEditing: true,
      Message_AllowEditing_BlockEditInMinutes: 0,
      Message_AllowDeleting: true,
      Message_AllowDeleting_BlockDeleteInMinutes: 0,
    });

    expect(
      conversationMessageActionsFrom(
        message(),
        { archived: true },
        writableSettings,
        {
          currentUserId: 'alice-id',
          currentUsername: 'alice',
          authorization: authorization({
            permissionsById: {
              'delete-own-message': ['user'],
            },
          }),
        },
      ),
    ).toEqual({
      edit: true,
      delete: true,
    });
  });

  test('keeps a fresh message editable through the same visible minute as the official Rocket.Chat client', () => {
    const writableSettings = settings({
      Message_AllowEditing: true,
      Message_AllowEditing_BlockEditInMinutes: 1,
      Message_AllowDeleting: true,
      Message_AllowDeleting_BlockDeleteInMinutes: 1,
    });
    const nowMs = Date.parse('2026-03-27T10:01:00.000Z');
    const originalNow = Date.now;
    Date.now = () => nowMs;

    try {
      expect(
        conversationMessageActionsFrom(
          message({
            ts: '2026-03-27T10:00:30.000Z',
          }),
          conversationRoom(),
          writableSettings,
          {
            currentUserId: 'alice-id',
            currentUsername: 'alice',
            authorization: authorization({
              permissionsById: {
                'delete-own-message': ['user'],
              },
            }),
          },
        ),
      ).toEqual({
        edit: true,
        delete: true,
      });
    } finally {
      Date.now = originalNow;
    }
  });
});
