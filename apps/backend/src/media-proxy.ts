import { AppError } from './errors';

const MEDIA_ROUTE_PREFIX = '/api/media';

const splitPathSegments = (value: string): string[] => value.split('/').filter((segment) => segment.length > 0);

const hasUnsafeSegments = (segments: string[]): boolean =>
  segments.some((segment) => segment === '.' || segment === '..');

const upstreamMediaPathFrom = (pathname: string, search = ''): string | undefined => {
  const segments = splitPathSegments(pathname);

  if (segments.length === 0 || hasUnsafeSegments(segments)) {
    return undefined;
  }

  const isRoomAvatar = segments.length === 3 && segments[0] === 'avatar' && segments[1] === 'room';
  const isUserAvatar = segments.length === 2 && segments[0] === 'avatar';
  const isFileUpload = segments.length >= 2 && segments[0] === 'file-upload';

  if (!isRoomAvatar && !isUserAvatar && !isFileUpload) {
    return undefined;
  }

  return `${pathname}${search}`;
};

export const toMediaProxyUrl = (upstreamUrl: string, rawUrl: string | undefined): string | undefined => {
  if (!rawUrl) {
    return undefined;
  }

  let resolved: URL;
  let upstreamOrigin: string;

  try {
    resolved = new URL(rawUrl, upstreamUrl);
    upstreamOrigin = new URL(upstreamUrl).origin;
  } catch {
    return undefined;
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return undefined;
  }

  if (resolved.origin !== upstreamOrigin) {
    return resolved.toString();
  }

  const upstreamPath = upstreamMediaPathFrom(resolved.pathname, resolved.search);
  return upstreamPath ? `${MEDIA_ROUTE_PREFIX}${upstreamPath}` : undefined;
};

export const toUpstreamMediaPath = (requestUrl: string, requestPath: string): string => {
  if (!requestPath.startsWith(MEDIA_ROUTE_PREFIX)) {
    throw new AppError('NOT_FOUND', 'Media resource not found', 404);
  }

  const suffix = requestPath.slice(MEDIA_ROUTE_PREFIX.length);
  if (!suffix.startsWith('/') || suffix.startsWith('//')) {
    throw new AppError('NOT_FOUND', 'Media resource not found', 404);
  }

  const pathname = new URL(requestUrl).pathname.slice(MEDIA_ROUTE_PREFIX.length);
  const upstreamPath = upstreamMediaPathFrom(pathname, new URL(requestUrl).search);
  if (!upstreamPath) {
    throw new AppError('NOT_FOUND', 'Media resource not found', 404);
  }

  return upstreamPath;
};
