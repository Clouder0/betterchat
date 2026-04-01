import type {
  ConversationCapabilities,
  ConversationMessageActions,
  ConversationMutationCapabilities,
  WorkspaceBootstrap,
} from '@betterchat/contracts';

import { hasPermission, type AuthorizationSnapshot } from './authorization';
import type { UpstreamMessage, UpstreamRoom, UpstreamSetting, UpstreamSubscription } from './upstream';

export const AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID = 'Cloud_Workspace_AirGapped_Restrictions_Remaining_Days';
export const THREADS_ENABLED_SETTING_ID = 'Threads_enabled';
export const MESSAGE_ALLOW_EDITING_SETTING_ID = 'Message_AllowEditing';
export const MESSAGE_ALLOW_EDITING_BLOCK_MINUTES_SETTING_ID = 'Message_AllowEditing_BlockEditInMinutes';
export const MESSAGE_ALLOW_DELETING_SETTING_ID = 'Message_AllowDeleting';
export const MESSAGE_ALLOW_DELETING_BLOCK_MINUTES_SETTING_ID = 'Message_AllowDeleting_BlockDeleteInMinutes';

export const WORKSPACE_SETTING_IDS = [
  'Site_Name',
  'Organization_Name',
  'FileUpload_Enabled',
  'FileUpload_Enabled_Direct',
  AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID,
] as const;

export const CONVERSATION_SETTING_IDS = [
  ...WORKSPACE_SETTING_IDS,
  THREADS_ENABLED_SETTING_ID,
  MESSAGE_ALLOW_EDITING_SETTING_ID,
  MESSAGE_ALLOW_EDITING_BLOCK_MINUTES_SETTING_ID,
  MESSAGE_ALLOW_DELETING_SETTING_ID,
  MESSAGE_ALLOW_DELETING_BLOCK_MINUTES_SETTING_ID,
] as const;

export const booleanSetting = (settings: UpstreamSetting[], settingId: string): boolean =>
  settings.some((setting) => setting._id === settingId && setting.value === true);

export const numericSetting = (settings: UpstreamSetting[], settingId: string): number | undefined => {
  const value = settings.find((setting) => setting._id === settingId)?.value;
  return typeof value === 'number' ? value : undefined;
};

export const workspaceWritesEnabledFrom = (settings: UpstreamSetting[]): boolean =>
  numericSetting(settings, AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID) !== 0;

export const threadsEnabledFrom = (settings: UpstreamSetting[]): boolean =>
  !settings.some((setting) => setting._id === THREADS_ENABLED_SETTING_ID) || booleanSetting(settings, THREADS_ENABLED_SETTING_ID);

const uploadsEnabledForRoomType = (roomType: string, settings: UpstreamSetting[]): boolean => {
  if (!workspaceWritesEnabledFrom(settings)) {
    return false;
  }

  return roomType === 'd' ? booleanSetting(settings, 'FileUpload_Enabled_Direct') : booleanSetting(settings, 'FileUpload_Enabled');
};

export const workspaceBootstrapCapabilitiesFrom = (
  settings: UpstreamSetting[],
): WorkspaceBootstrap['capabilities'] => {
  const writesEnabled = workspaceWritesEnabledFrom(settings);

  return {
    canSendMessages: writesEnabled,
    canUploadImages: uploadsEnabledForRoomType('c', settings),
    canUploadImagesInDirectMessages: uploadsEnabledForRoomType('d', settings),
    realtimeEnabled: true,
  };
};

type CapabilityProjectionOptions = {
  authorization?: AuthorizationSnapshot;
  currentUserId?: string;
  currentUsername?: string;
  subscription?: Pick<UpstreamSubscription, 'archived' | 'blocked' | 'blocker' | 'roles'>;
};

const currentUserIncludedIn = (members: string[] | undefined, currentUsername: string | undefined): boolean =>
  currentUsername !== undefined && members?.includes(currentUsername) === true;

const conversationArchivedFrom = (
  room: Pick<UpstreamRoom, 'archived'>,
  subscription: CapabilityProjectionOptions['subscription'],
): boolean => room.archived === true || subscription?.archived === true;

const roomReadonlyForCurrentUser = (
  room: Pick<UpstreamRoom, 'ro' | 'unmuted'>,
  currentUsername: string | undefined,
  authorization: AuthorizationSnapshot | undefined,
): boolean =>
  room.ro === true
  && !currentUserIncludedIn(room.unmuted, currentUsername)
  && !hasPermission(authorization, 'post-readonly');

const roomMutedForCurrentUser = (
  room: Pick<UpstreamRoom, 'muted'>,
  currentUsername: string | undefined,
): boolean => currentUserIncludedIn(room.muted, currentUsername);

const directConversationBlocked = (
  subscription: CapabilityProjectionOptions['subscription'],
): boolean => subscription?.blocked === true || subscription?.blocker === true;

const sendMessagesAllowedFrom = (
  room: Pick<UpstreamRoom, 'archived' | 'muted' | 'ro' | 'unmuted'>,
  settings: UpstreamSetting[],
  options: CapabilityProjectionOptions,
): boolean => {
  const archived = conversationArchivedFrom(room, options.subscription);
  const muted = roomMutedForCurrentUser(room, options.currentUsername);
  const readonly = roomReadonlyForCurrentUser(room, options.currentUsername, options.authorization);
  const blocked = directConversationBlocked(options.subscription);

  return workspaceWritesEnabledFrom(settings) && !archived && !muted && !readonly && !blocked;
};

const editMessagesAllowedFrom = (
  room: Pick<UpstreamRoom, 'muted' | 'ro' | 'unmuted'>,
  settings: UpstreamSetting[],
  options: CapabilityProjectionOptions,
): boolean => {
  const muted = roomMutedForCurrentUser(room, options.currentUsername);
  const readonly = roomReadonlyForCurrentUser(room, options.currentUsername, options.authorization);
  const blocked = directConversationBlocked(options.subscription);

  return workspaceWritesEnabledFrom(settings) && !muted && !readonly && !blocked;
};

const mutationCapabilitiesFrom = (
  enabled: boolean,
  threadsEnabled: boolean,
  threadEchoToConversation: boolean,
): ConversationMutationCapabilities => ({
  conversation: enabled,
  conversationReply: enabled,
  thread: enabled && threadsEnabled,
  threadEchoToConversation: enabled && threadsEnabled && threadEchoToConversation,
});

export const conversationCapabilitiesFrom = (
  room: Pick<UpstreamRoom, 'archived' | 'muted' | 'reactWhenReadOnly' | 'ro' | 't' | 'unmuted'>,
  settings: UpstreamSetting[],
  options: CapabilityProjectionOptions = {},
): ConversationCapabilities => {
  const muted = roomMutedForCurrentUser(room, options.currentUsername);
  const readonly = roomReadonlyForCurrentUser(room, options.currentUsername, options.authorization);
  const sendMessages = sendMessagesAllowedFrom(room, settings, options);
  const uploadMedia = sendMessages && uploadsEnabledForRoomType(room.t, settings);
  const threadsEnabled = threadsEnabledFrom(settings);

  return {
    star: true,
    hide: true,
    markRead: true,
    markUnread: true,
    react:
      !muted
      && (!readonly || room.reactWhenReadOnly === true || hasPermission(options.authorization, 'post-readonly')),
    messageMutations: mutationCapabilitiesFrom(sendMessages, threadsEnabled, true),
    mediaMutations: mutationCapabilitiesFrom(uploadMedia, threadsEnabled, false),
  };
};

const nonDeletedMessage = (message: Pick<UpstreamMessage, '_deletedAt' | 't'>): boolean =>
  message._deletedAt === undefined && message.t !== 'rm';

const elapsedMinutesFrom = (timestamp: string | undefined, nowMs = Date.now()): number | undefined => {
  if (!timestamp) {
    return undefined;
  }

  const authoredAtMs = Date.parse(timestamp);
  if (!Number.isFinite(authoredAtMs)) {
    return undefined;
  }

  return Math.max(0, Math.floor((nowMs - authoredAtMs) / 1000 / 60));
};

const editWindowAllowsMessage = (
  message: Pick<UpstreamMessage, 'ts'>,
  settings: UpstreamSetting[],
  authorization: AuthorizationSnapshot | undefined,
): boolean => {
  if (hasPermission(authorization, 'bypass-time-limit-edit-and-delete')) {
    return true;
  }

  const blockEditInMinutes = numericSetting(settings, MESSAGE_ALLOW_EDITING_BLOCK_MINUTES_SETTING_ID);
  if (blockEditInMinutes === undefined || blockEditInMinutes === 0) {
    return true;
  }

  const elapsedMinutes = elapsedMinutesFrom(message.ts);
  return elapsedMinutes !== undefined && elapsedMinutes <= blockEditInMinutes;
};

const deleteWindowAllowsMessage = (
  message: Pick<UpstreamMessage, 'ts'>,
  settings: UpstreamSetting[],
  authorization: AuthorizationSnapshot | undefined,
): boolean => {
  if (hasPermission(authorization, 'bypass-time-limit-edit-and-delete')) {
    return true;
  }

  const blockDeleteInMinutes = numericSetting(settings, MESSAGE_ALLOW_DELETING_BLOCK_MINUTES_SETTING_ID);
  if (blockDeleteInMinutes === undefined || blockDeleteInMinutes === 0) {
    return true;
  }

  const elapsedMinutes = elapsedMinutesFrom(message.ts);
  return elapsedMinutes !== undefined && elapsedMinutes <= blockDeleteInMinutes;
};

export const conversationMessageActionsFrom = (
  message: Pick<UpstreamMessage, '_deletedAt' | 't' | 'ts' | 'u'>,
  room: Pick<UpstreamRoom, 'archived' | 'muted' | 'ro' | 'unmuted'>,
  settings: UpstreamSetting[],
  options: CapabilityProjectionOptions,
): ConversationMessageActions => {
  if (!nonDeletedMessage(message) || !options.currentUserId) {
    return {
      edit: false,
      delete: false,
    };
  }

  const authorIsCurrentUser = message.u._id === options.currentUserId;
  const editMessagesAllowed = editMessagesAllowedFrom(room, settings, options);

  const canEdit =
    editMessagesAllowed
    && (
      hasPermission(options.authorization, 'edit-message')
      || (
        booleanSetting(settings, MESSAGE_ALLOW_EDITING_SETTING_ID)
        && authorIsCurrentUser
      )
    )
    && editWindowAllowsMessage(message, settings, options.authorization);

  if (hasPermission(options.authorization, 'force-delete-message')) {
    return {
      edit: canEdit,
      delete: true,
    };
  }

  if (!booleanSetting(settings, MESSAGE_ALLOW_DELETING_SETTING_ID) || !deleteWindowAllowsMessage(message, settings, options.authorization)) {
    return {
      edit: canEdit,
      delete: false,
    };
  }

  const canDeleteAny = hasPermission(options.authorization, 'delete-message');
  const canDeleteOwn = authorIsCurrentUser && hasPermission(options.authorization, 'delete-own-message');

  if (!canDeleteAny && !canDeleteOwn) {
    return {
      edit: canEdit,
      delete: false,
    };
  }

  if (room.ro === true && !hasPermission(options.authorization, 'post-readonly')) {
    if (message.u.username && !currentUserIncludedIn(room.unmuted, message.u.username)) {
      return {
        edit: canEdit,
        delete: false,
      };
    }
  }

  return {
    edit: canEdit,
    delete: true,
  };
};
