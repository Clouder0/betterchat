import type { AppError } from './errors';

const REQUEST_ID_HEADER = 'x-request-id';
const requestIdByRequest = new WeakMap<Request, string>();

export type BetterChatLogger = {
  error: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
};

const log = (level: 'error' | 'info' | 'warn', message: string, fields: Record<string, unknown> = {}): void => {
  const payload = {
    component: 'betterchat-backend',
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
};

export const consoleLogger: BetterChatLogger = {
  error: (message, fields) => log('error', message, fields),
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
};

export const requestIdHeaderName = REQUEST_ID_HEADER;

export const requestIdFrom = (request: Request): string => {
  const existing = requestIdByRequest.get(request);
  if (existing) {
    return existing;
  }

  const fromHeader = request.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = fromHeader && fromHeader.length > 0 ? fromHeader.slice(0, 200) : crypto.randomUUID();
  requestIdByRequest.set(request, requestId);
  return requestId;
};

export const applyRequestId = (response: Response, request: Request): Response => {
  response.headers.set(REQUEST_ID_HEADER, requestIdFrom(request));
  return response;
};

export const logRequestError = (
  logger: BetterChatLogger,
  request: Request,
  error: AppError,
  durationMs: number,
): void => {
  logger.warn('request_failed', {
    durationMs,
    errorCode: error.code,
    errorMessage: error.message,
    method: request.method,
    path: new URL(request.url).pathname,
    requestId: requestIdFrom(request),
    status: error.status,
  });
};
