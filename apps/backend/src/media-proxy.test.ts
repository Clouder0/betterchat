import { describe, expect, test } from 'bun:test';

import { toMediaProxyUrl, toUpstreamMediaPath } from './media-proxy';

describe('media proxy path validation', () => {
  test('allows supported avatar and file-upload paths only', () => {
    expect(toUpstreamMediaPath('http://betterchat.test/api/media/avatar/alice?format=png', '/api/media/avatar/alice')).toBe(
      '/avatar/alice?format=png',
    );
    expect(toUpstreamMediaPath('http://betterchat.test/api/media/avatar/room/room-1', '/api/media/avatar/room/room-1')).toBe(
      '/avatar/room/room-1',
    );
    expect(
      toUpstreamMediaPath(
        'http://betterchat.test/api/media/file-upload/file-1/pixel.png?download=1',
        '/api/media/file-upload/file-1/pixel.png',
      ),
    ).toBe('/file-upload/file-1/pixel.png?download=1');
  });

  test('rejects non-media upstream tunneling attempts', () => {
    expect(() => toUpstreamMediaPath('http://betterchat.test/api/media/api/v1/me', '/api/media/api/v1/me')).toThrow(
      'Media resource not found',
    );
    expect(() =>
      toUpstreamMediaPath(
        'http://betterchat.test/api/media//127.0.0.1:3200/api/public/bootstrap',
        '/api/media//127.0.0.1:3200/api/public/bootstrap',
      ),
    ).toThrow('Media resource not found');
    expect(() =>
      toUpstreamMediaPath('http://betterchat.test/api/media/file-upload/../secrets', '/api/media/file-upload/../secrets'),
    ).toThrow('Media resource not found');
  });

  test('keeps external media external while proxying supported upstream-local media paths', () => {
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'https://cdn.example.com/pixel.png')).toBe('https://cdn.example.com/pixel.png');
    expect(toMediaProxyUrl('http://127.0.0.1:3100', '/file-upload/file-1/pixel.png?download=1')).toBe(
      '/api/media/file-upload/file-1/pixel.png?download=1',
    );
    expect(toMediaProxyUrl('http://127.0.0.1:3100', '/api/v1/me')).toBeUndefined();
  });

  test('drops unsafe or malformed media URLs instead of passing them through or throwing', () => {
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'javascript:alert(1)')).toBeUndefined();
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'file:///tmp/pixel.png')).toBeUndefined();
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'blob:https://cdn.example.com/id')).toBeUndefined();
    expect(toMediaProxyUrl('http://127.0.0.1:3100', 'http://[::1')).toBeUndefined();
  });
});
