import { describe, expect, test } from 'bun:test';

import { AppError } from './errors';
import { encodePaginationCursor, nextCursorFrom, parsePaginationRequest } from './pagination';

describe('pagination helpers', () => {
  test('round-trips opaque cursors into upstream offsets', () => {
    const cursor = encodePaginationCursor(25);
    const parsed = parsePaginationRequest({ cursor }, { defaultLimit: 50, maxLimit: 100 });

    expect(parsed).toEqual({
      offset: 25,
      limit: 50,
    });
  });

  test('uses the default limit and clamps oversized limit requests', () => {
    expect(parsePaginationRequest({}, { defaultLimit: 50, maxLimit: 100 })).toEqual({ offset: 0, limit: 50 });
    expect(parsePaginationRequest({ limit: '250' }, { defaultLimit: 50, maxLimit: 100 })).toEqual({ offset: 0, limit: 100 });
  });

  test('rejects malformed cursors and invalid limit values explicitly', () => {
    expect(() => parsePaginationRequest({ cursor: 'not-base64' }, { defaultLimit: 50, maxLimit: 100 })).toThrow(
      new AppError('VALIDATION_ERROR', '"cursor" must be a valid BetterChat pagination cursor', 400),
    );

    expect(() => parsePaginationRequest({ cursor: encodePaginationCursor(-1) }, { defaultLimit: 50, maxLimit: 100 })).toThrow(
      new AppError('VALIDATION_ERROR', '"cursor" must be a valid BetterChat pagination cursor', 400),
    );

    expect(() => parsePaginationRequest({ limit: '0' }, { defaultLimit: 50, maxLimit: 100 })).toThrow(
      new AppError('VALIDATION_ERROR', '"limit" must be a positive integer when provided', 400),
    );

    expect(() => parsePaginationRequest({ limit: '1.5' }, { defaultLimit: 50, maxLimit: 100 })).toThrow(
      new AppError('VALIDATION_ERROR', '"limit" must be a positive integer when provided', 400),
    );
  });

  test('computes the next older-history cursor only when more results exist', () => {
    expect(nextCursorFrom({ offset: 0, count: 20, total: 60 })).toBe(encodePaginationCursor(20));
    expect(nextCursorFrom({ offset: 40, count: 20, total: 60 })).toBeUndefined();
    expect(nextCursorFrom({ offset: 0, count: 0, total: 0 })).toBeUndefined();
  });
});
