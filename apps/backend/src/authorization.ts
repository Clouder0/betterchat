import type { UpstreamMeResponse, UpstreamPermissionDefinition, UpstreamSubscription } from './upstream';

const normalizedRoleIdsFrom = (roleIds: string[] | undefined): Set<string> =>
  new Set((roleIds || []).filter((roleId) => typeof roleId === 'string' && roleId.length > 0));

const permissionRoleIdsByPermissionIdFrom = (
  permissions: UpstreamPermissionDefinition[],
): Map<string, Set<string>> =>
  new Map(
    permissions.map((permission) => [
      permission._id,
      normalizedRoleIdsFrom(permission.roles),
    ]),
  );

export type AuthorizationSnapshot = {
  globalRoleIds: Set<string>;
  roomRoleIds: Set<string>;
  subjectRoleIds: Set<string>;
  permissionRoleIdsByPermissionId: Map<string, Set<string>>;
};

export const authorizationSnapshotFrom = (
  me: Pick<UpstreamMeResponse, 'roles'>,
  subscription: Pick<UpstreamSubscription, 'roles'> | undefined,
  permissions: UpstreamPermissionDefinition[],
): AuthorizationSnapshot => {
  const globalRoleIds = normalizedRoleIdsFrom(me.roles);
  const roomRoleIds = normalizedRoleIdsFrom(subscription?.roles);

  return {
    globalRoleIds,
    roomRoleIds,
    subjectRoleIds: new Set([...globalRoleIds, ...roomRoleIds]),
    permissionRoleIdsByPermissionId: permissionRoleIdsByPermissionIdFrom(permissions),
  };
};

export const hasPermission = (
  authorization: AuthorizationSnapshot | undefined,
  permissionId: string,
): boolean => {
  if (!authorization) {
    return false;
  }

  const permissionRoleIds = authorization.permissionRoleIdsByPermissionId.get(permissionId);
  if (!permissionRoleIds || permissionRoleIds.size === 0) {
    return false;
  }

  for (const roleId of permissionRoleIds) {
    if (authorization.subjectRoleIds.has(roleId)) {
      return true;
    }
  }

  return false;
};
