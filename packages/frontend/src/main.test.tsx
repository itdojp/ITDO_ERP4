/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRootMock, renderMock, AppMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const createRootMock = vi.fn(() => ({ render: renderMock }));
  const AppMock = vi.fn(() => <div data-testid="app-mock" />);
  return { createRootMock, renderMock, AppMock };
});

const navigatorPrototype = Object.getPrototypeOf(
  navigator,
) as typeof navigator & {
  serviceWorker?: { register: ReturnType<typeof vi.fn> };
};
const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigatorPrototype,
  'serviceWorker',
);

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}));
vi.mock('./pages/App', () => ({ App: AppMock }));

function setServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigatorPrototype, 'serviceWorker', {
    configurable: true,
    value: { register },
  });
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(
      navigatorPrototype,
      'serviceWorker',
      originalServiceWorkerDescriptor,
    );
  } else {
    delete (navigatorPrototype as Partial<typeof navigatorPrototype>)
      .serviceWorker;
  }
  createRootMock.mockClear();
  renderMock.mockClear();
  AppMock.mockClear();
});

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  createRootMock.mockClear();
  renderMock.mockClear();
  AppMock.mockClear();
});

describe('main', () => {
  it('renders App into the root element', async () => {
    await import('./main');

    const root = document.getElementById('root');
    expect(createRootMock).toHaveBeenCalledWith(root);
    expect(renderMock).toHaveBeenCalledTimes(1);

    const renderedElement = renderMock.mock
      .calls[0]?.[0] as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    expect(renderedElement.type).toBe(React.StrictMode);
    expect((renderedElement.props.children as React.ReactElement).type).toBe(
      AppMock,
    );
  });

  it('registers the service worker after load when enabled', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    setServiceWorker(register);
    vi.stubEnv('VITE_ENABLE_SW', 'true');

    await import('./main');

    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/sw.js');
    });
  });

  it('logs service worker registration failures in DEV', async () => {
    const register = vi.fn().mockRejectedValue(new Error('boom'));
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    setServiceWorker(register);
    vi.stubEnv('VITE_ENABLE_SW', 'true');
    vi.stubEnv('DEV', true);

    try {
      await import('./main');
      window.dispatchEvent(new Event('load'));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Service worker registration failed',
          expect.any(Error),
        );
      });
      expect(register).toHaveBeenCalledWith('/sw.js');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
