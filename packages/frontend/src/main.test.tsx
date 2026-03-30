/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRootMock, renderMock, AppMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const createRootMock = vi.fn(() => ({ render: renderMock }));
  const AppMock = vi.fn(() => <div data-testid="app-mock" />);
  return { createRootMock, renderMock, AppMock };
});

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}));
vi.mock('./pages/App', () => ({ App: AppMock }));

type MainLoadOptions = {
  dev?: boolean;
  enableServiceWorker?: boolean;
  prod?: boolean;
  registerImpl?: () => Promise<unknown>;
  withServiceWorker?: boolean;
};

const navigatorPrototype = Object.getPrototypeOf(navigator) as Navigator;
const originalNavigatorServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
);
const originalPrototypeServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigatorPrototype,
  'serviceWorker',
);

function restoreServiceWorker() {
  if (originalNavigatorServiceWorkerDescriptor) {
    Object.defineProperty(
      navigator,
      'serviceWorker',
      originalNavigatorServiceWorkerDescriptor,
    );
    return;
  }

  delete (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker;

  if (originalPrototypeServiceWorkerDescriptor) {
    Object.defineProperty(
      navigatorPrototype,
      'serviceWorker',
      originalPrototypeServiceWorkerDescriptor,
    );
  } else {
    delete (navigatorPrototype as Navigator & { serviceWorker?: unknown })
      .serviceWorker;
  }
}

async function loadMain(options: MainLoadOptions = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('DEV', options.dev ?? true);
  vi.stubEnv('PROD', options.prod ?? false);
  vi.stubEnv('VITE_ENABLE_SW', options.enableServiceWorker ? 'true' : '');

  document.body.innerHTML = '<div id="root"></div>';

  let loadListener: EventListener | undefined;
  vi.spyOn(window, 'addEventListener').mockImplementation((
    (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === 'load' && typeof listener === 'function') {
        loadListener = listener;
      }
    }
  ) as typeof window.addEventListener);

  const registerMock = vi.fn(
    options.registerImpl ?? (() => Promise.resolve(undefined)),
  );

  if (options.withServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: registerMock },
    });
  }

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await import('./main');

  return { errorSpy, loadListener, registerMock };
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  restoreServiceWorker();
});

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  restoreServiceWorker();
});

describe('main', () => {
  it('renders App into the root element', async () => {
    await loadMain();

    const root = document.getElementById('root');
    expect(createRootMock).toHaveBeenCalledWith(root);
    expect(renderMock).toHaveBeenCalledTimes(1);

    const renderedElement = renderMock.mock
      .calls[0]?.[0] as React.ReactElement<{ children?: React.ReactNode }>;
    expect(renderedElement.type).toBe(React.StrictMode);
    expect((renderedElement.props.children as React.ReactElement).type).toBe(
      AppMock,
    );
  });

  it('does not register the service worker unless the feature is enabled', async () => {
    const { loadListener, registerMock } = await loadMain();

    expect(loadListener).toBeUndefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'PROD',
      options: {
        dev: false,
        enableServiceWorker: false,
        prod: true,
        withServiceWorker: true,
      },
    },
    {
      label: 'VITE_ENABLE_SW=true',
      options: {
        dev: true,
        enableServiceWorker: true,
        prod: false,
        withServiceWorker: true,
      },
    },
  ])('registers /sw.js after load when $label is set', async ({ options }) => {
    const { loadListener, registerMock } = await loadMain(options);

    expect(loadListener).toBeInstanceOf(Function);
    loadListener?.(new Event('load'));

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('/sw.js');
  });

  it('logs service worker registration failures in DEV', async () => {
    const error = new Error('register failed');
    const { loadListener, errorSpy, registerMock } = await loadMain({
      dev: true,
      enableServiceWorker: true,
      prod: false,
      withServiceWorker: true,
      registerImpl: () => Promise.reject(error),
    });

    loadListener?.(new Event('load'));
    await Promise.resolve();

    expect(registerMock).toHaveBeenCalledWith('/sw.js');
    expect(errorSpy).toHaveBeenCalledWith(
      'Service worker registration failed',
      error,
    );
  });

  it('suppresses service worker registration failures outside DEV', async () => {
    const error = new Error('register failed');
    const { loadListener, errorSpy, registerMock } = await loadMain({
      dev: false,
      enableServiceWorker: false,
      prod: true,
      withServiceWorker: true,
      registerImpl: () => Promise.reject(error),
    });

    loadListener?.(new Event('load'));
    await Promise.resolve();

    expect(registerMock).toHaveBeenCalledWith('/sw.js');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
