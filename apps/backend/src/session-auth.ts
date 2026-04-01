import type { BetterChatConfig } from './config';
import { deserializeSessionCookie, type UpstreamSession } from './session';

export const readCookie = (request: Request, cookieName: string): string | undefined => {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === cookieName) {
      try {
        return decodeURIComponent(valueParts.join('='));
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
};

export const readSessionCookieFromRequest = (config: BetterChatConfig, request: Request): string | undefined =>
  readCookie(request, config.sessionCookieName);

export const getSessionFromRequest = (config: BetterChatConfig, request: Request): UpstreamSession | undefined =>
  deserializeSessionCookie(config, readSessionCookieFromRequest(config, request));
