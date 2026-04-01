import type { ApiError, ApiErrorCode } from '@betterchat/contracts';
import type { Context } from 'hono';

export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 501 | 502 | 503;

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly status: AppErrorStatus;

  constructor(code: ApiErrorCode, message: string, status: AppErrorStatus, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

export const toAppError = (value: unknown): AppError => {
  if (isAppError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new AppError('UPSTREAM_UNAVAILABLE', value.message, 503);
  }

  return new AppError('UPSTREAM_UNAVAILABLE', 'Unexpected failure', 503, value);
};

const toErrorBody = (error: AppError): ApiError => ({
  ok: false,
  error: {
    code: error.code,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  },
});

export const responseFromAppError = (error: AppError): Response =>
  Response.json(toErrorBody(error), {
    status: error.status,
  });

export const jsonError = (c: Context, error: AppError): Response => c.json(toErrorBody(error), error.status);
