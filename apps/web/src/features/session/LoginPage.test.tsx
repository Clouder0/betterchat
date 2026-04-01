import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';

// Mock the betterchat API module
const mockLogin = mock(() => Promise.resolve({}));
const mockPublicBootstrap = mock(() =>
  Promise.resolve({
    server: { siteName: 'Test', version: '1.0.0' },
    login: { registeredProviders: [], passwordEnabled: true },
  })
);
const mockWorkspace = mock(() =>
  Promise.reject({
    code: 'UNAUTHENTICATED',
    message: 'Not authenticated',
  })
);

mock.module('@/lib/betterchat', () => ({
  betterChatApi: {
    mode: 'real',
    publicBootstrap: mockPublicBootstrap,
    workspace: mockWorkspace,
    login: mockLogin,
  },
  betterChatQueryKeys: {
    publicBootstrap: ['publicBootstrap'],
    workspace: ['workspace'],
    roomList: ['roomList'],
  },
  isBetterChatApiError: (error: unknown) => {
    return error && typeof error === 'object' && 'code' in error;
  },
}));

// Mock react-router
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({}),
  useSearch: () => ({}),
}));

// Import the component after mocking
const { LoginPage } = await import('./LoginPage');

describe('LoginPage ARIA Accessibility - Issue #8', () => {
  let win: Window;

  beforeEach(() => {
    win = new Window({ url: 'http://localhost:3000' });
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document as unknown as Document;
    globalThis.navigator = win.navigator as unknown as Navigator;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.Element = win.Element as unknown as typeof Element;

    mockPublicBootstrap.mockClear();
    mockWorkspace.mockClear();
    mockLogin.mockClear();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { navigator?: unknown }).navigator;
    delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    delete (globalThis as { Element?: unknown }).Element;
  });

  function renderWithQueryClient(element: React.ReactElement) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    });

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    root.render(
      <QueryClientProvider client={queryClient}>
        {element}
      </QueryClientProvider>
    );
    return { container, root };
  }

  const hasAttribute = (html: string, testId: string, attr: string, value?: string): boolean => {
    const testIdPattern = new RegExp(`data-testid=["']${testId}["']`);
    if (!testIdPattern.test(html)) return false;

    const tagPattern = new RegExp(`<div[^>]*data-testid=["']${testId}["'][^>]*>`, 'i');
    const match = html.match(tagPattern);
    if (!match) return false;

    const tag = match[0];

    if (value) {
      const attrPattern = new RegExp(`${attr}=["']${value}["']`);
      return attrPattern.test(tag);
    } else {
      return tag.includes(`${attr}=`);
    }
  };

  it('GREEN: error message div has role="alert" attribute when present', async () => {
    mockPublicBootstrap.mockImplementation(() =>
      Promise.reject({
        code: 'SERVER_ERROR',
        message: 'Server connection failed',
      })
    );

    const { container } = renderWithQueryClient(<LoginPage />);

    await new Promise(resolve => setTimeout(resolve, 50));

    const html = container.innerHTML;

    expect(html).toContain('data-testid="login-error"');
    expect(hasAttribute(html, 'login-error', 'role', 'alert')).toBe(true);
  });

  it('GREEN: error message div has aria-live="assertive" attribute when present', async () => {
    mockPublicBootstrap.mockImplementation(() =>
      Promise.reject({
        code: 'AUTH_ERROR',
        message: 'Invalid credentials',
      })
    );

    const { container } = renderWithQueryClient(<LoginPage />);

    await new Promise(resolve => setTimeout(resolve, 50));

    const html = container.innerHTML;

    expect(html).toContain('data-testid="login-error"');
    expect(hasAttribute(html, 'login-error', 'aria-live', 'assertive')).toBe(true);
  });

  it('GREEN: error message is accessible to screen readers with all ARIA attributes', async () => {
    const errorMessage = 'Network connection error';
    mockPublicBootstrap.mockImplementation(() =>
      Promise.reject({
        code: 'NETWORK_ERROR',
        message: errorMessage,
      })
    );

    const { container } = renderWithQueryClient(<LoginPage />);

    await new Promise(resolve => setTimeout(resolve, 50));

    const html = container.innerHTML;

    expect(html).toContain(errorMessage);
    expect(hasAttribute(html, 'login-error', 'role', 'alert')).toBe(true);
    expect(hasAttribute(html, 'login-error', 'aria-live', 'assertive')).toBe(true);
  });

  it('GREEN: no error div rendered when there is no error', async () => {
    mockPublicBootstrap.mockImplementation(() =>
      Promise.resolve({
        server: { siteName: 'Test', version: '1.0.0' },
        login: { registeredProviders: [], passwordEnabled: true },
      })
    );

    const { container } = renderWithQueryClient(<LoginPage />);

    await new Promise(resolve => setTimeout(resolve, 50));

    const html = container.innerHTML;

    expect(html).not.toContain('data-testid="login-error"');
  });
});
