import type { PublicBootstrap, SessionUser, UserSummary, WorkspaceBootstrap } from '@betterchat/contracts';

import { toMediaProxyUrl } from './media-proxy';
import { presenceStateFromStatus } from './presence';
import type {
  UpstreamInfoResponse,
  UpstreamOauthResponse,
  UpstreamSetting,
  UpstreamSettingsResponse,
  UpstreamUser,
} from './upstream';

const settingMapFrom = (settings: UpstreamSetting[]): Map<string, unknown> => new Map(settings.map((setting) => [setting._id, setting.value]));

const stringSetting = (settings: Map<string, unknown>, key: string): string | undefined => {
  const value = settings.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const booleanSetting = (settings: Map<string, unknown>, key: string): boolean | undefined => {
  const value = settings.get(key);
  return typeof value === 'boolean' ? value : undefined;
};

export { toMediaProxyUrl };

export const toUserAvatarProxyUrl = (username: string | undefined): string | undefined =>
  username ? `/api/media/avatar/${encodeURIComponent(username)}` : undefined;

export const toRoomAvatarProxyUrl = (roomId: string | undefined): string | undefined =>
  roomId ? `/api/media/avatar/room/${encodeURIComponent(roomId)}` : undefined;

export const normalizeSessionUser = (user: UpstreamUser): SessionUser => ({
  id: user._id,
  username: user.username,
  displayName: user.name || user.username,
  avatarUrl: toUserAvatarProxyUrl(user.username),
  status: user.status,
});

type NormalizableUserSummary = {
  _id: string;
  username?: string;
  name?: string;
  status?: string;
};

const displayNameFromUserSummary = (user: Pick<NormalizableUserSummary, '_id' | 'username' | 'name'>): string =>
  user.name?.trim() || user.username?.trim() || user._id;

export const normalizeUserSummary = (
  user: NormalizableUserSummary,
  presence?: string,
): UserSummary => ({
  id: user._id,
  username: user.username,
  displayName: displayNameFromUserSummary(user),
  avatarUrl: toUserAvatarProxyUrl(user.username),
  presence: presenceStateFromStatus(presence ?? user.status),
});

export const normalizePublicBootstrap = (
  info: UpstreamInfoResponse,
  settingsResponse: UpstreamSettingsResponse,
  oauthResponse: UpstreamOauthResponse,
  authenticated: boolean,
): PublicBootstrap => {
  const settings = settingMapFrom(settingsResponse.settings);
  const registrationMode = stringSetting(settings, 'Accounts_RegistrationForm');

  return {
    server: {
      version: info.version,
      siteName: stringSetting(settings, 'Site_Name') || stringSetting(settings, 'Organization_Name'),
    },
    session: {
      authenticated,
    },
    login: {
      passwordEnabled: booleanSetting(settings, 'Accounts_ShowFormLogin') ?? true,
      registeredProviders: oauthResponse.services
        .map((service) => {
          const name = service.name || service.service;
          if (!name) {
            return undefined;
          }

          return {
            name,
            label: service.buttonLabelText || name,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== undefined),
    },
    features: {
      registerEnabled: registrationMode === 'Public',
    },
  };
};

export const normalizeWorkspaceBootstrap = (
  user: UpstreamUser,
  info: UpstreamInfoResponse,
  settingsResponse: UpstreamSettingsResponse,
  capabilities: WorkspaceBootstrap['capabilities'],
): WorkspaceBootstrap => {
  const settings = settingMapFrom(settingsResponse.settings);

  return {
    currentUser: normalizeSessionUser(user),
    workspace: {
      name: stringSetting(settings, 'Site_Name') || stringSetting(settings, 'Organization_Name') || 'Rocket.Chat',
      version: info.info?.version || info.version,
    },
    capabilities,
  };
};
