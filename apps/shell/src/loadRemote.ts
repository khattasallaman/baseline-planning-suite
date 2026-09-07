export interface RuntimeConfig {
  remotes: {
    people: string;
    delivery: string;
  };
  /** Set people or delivery URL to a broken path to demo isolation. */
  breakRemote?: 'people' | 'delivery' | null;
}

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

type SharedScope = Record<string, unknown>;

interface FederationContainer {
  init: (shareScope: SharedScope) => Promise<void> | void;
  get: (module: string) => Promise<() => unknown>;
}

let shareScopeInitialised = false;

async function ensureShareScope(): Promise<SharedScope> {
  const scope = (window.__BASELINE_SHARE_SCOPE__ ?? {}) as SharedScope;
  window.__BASELINE_SHARE_SCOPE__ = scope;

  // Provide React / react-dom as host singletons for remotes that expect shared scopes.
  if (!shareScopeInitialised) {
    const react = await import('react');
    const reactDom = await import('react-dom');
    const reactJsx = await import('react/jsx-runtime');

    const put = (name: string, version: string, mod: unknown) => {
      const bucket = (scope[name] as Record<string, { get: () => Promise<() => unknown>; loaded?: number }> | undefined) ?? {};
      bucket[version] = {
        get: () => Promise.resolve(() => mod),
        loaded: 1,
      };
      scope[name] = bucket;
    };

    put('react', '18.3.1', react);
    put('react-dom', '18.3.1', reactDom);
    put('react/jsx-runtime', '18.3.1', reactJsx);
    shareScopeInitialised = true;
  }

  return scope;
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-remote="${url}"]`,
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.type = 'text/javascript';
    script.async = true;
    script.dataset.remote = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load remote entry: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Runtime Module Federation loader.
 * Remote URLs come from /config.json — never from the shell bundle.
 */
export async function loadRemoteModule<T>(
  remoteEntryUrl: string,
  scopeName: string,
  moduleName: string,
): Promise<T> {
  // vite-plugin-federation remoteEntry is an ES module in modern builds.
  // Prefer dynamic import; fall back to classic container script pattern.
  try {
    const container = (await import(
      /* @vite-ignore */ remoteEntryUrl
    )) as FederationContainer & { get?: FederationContainer['get']; init?: FederationContainer['init'] };

    const shareScope = await ensureShareScope();
    if (typeof container.init === 'function') {
      await container.init(shareScope);
    }
    if (typeof container.get === 'function') {
      const factory = await container.get(moduleName);
      return factory() as T;
    }
    // Some builds export the module map directly
    const direct = (container as unknown as Record<string, unknown>)[moduleName];
    if (direct) return direct as T;
  } catch {
    // classic script fallback
  }

  await loadScript(remoteEntryUrl);
  const container = window[scopeName] as FederationContainer | undefined;
  if (!container) {
    throw new Error(`Remote scope "${scopeName}" not found after loading ${remoteEntryUrl}`);
  }
  const shareScope = await ensureShareScope();
  await container.init(shareScope);
  const factory = await container.get(moduleName);
  return factory() as T;
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load /config.json');
  return res.json() as Promise<RuntimeConfig>;
}
