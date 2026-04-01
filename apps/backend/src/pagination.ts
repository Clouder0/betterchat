import { AppError } from './errors';

type PaginationCursorPayload = {
  offset: number;
};

export type PaginationRequest = {
  offset: number;
  limit: number;
};

export const encodePaginationCursor = (offset: number): string => Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');

const decodePaginationCursor = (cursor: string): PaginationCursorPayload => {
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as PaginationCursorPayload;
    if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.offset) || payload.offset < 0) {
      throw new Error('invalid cursor payload');
    }

    return payload;
  } catch {
    throw new AppError('VALIDATION_ERROR', '"cursor" must be a valid BetterChat pagination cursor', 400);
  }
};

const parsePositiveInteger = (value: string, fieldName: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be a positive integer when provided`, 400);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be a positive integer when provided`, 400);
  }

  return parsed;
};

export const parsePaginationRequest = (
  input: {
    cursor?: string;
    limit?: string;
  },
  config: {
    defaultLimit: number;
    maxLimit: number;
  },
): PaginationRequest => {
  const offset = input.cursor ? decodePaginationCursor(input.cursor).offset : 0;
  const limit = input.limit ? Math.min(parsePositiveInteger(input.limit, 'limit'), config.maxLimit) : config.defaultLimit;

  return {
    offset,
    limit,
  };
};

export const nextCursorFrom = ({
  offset,
  count,
  total,
}: {
  offset: number;
  count: number;
  total: number;
}): string | undefined => {
  const nextOffset = offset + count;
  if (count <= 0 || nextOffset >= total) {
    return undefined;
  }

  return encodePaginationCursor(nextOffset);
};
