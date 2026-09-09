import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { DisplayCurrency, ShellRuntimeProps } from '@baseline/contracts';
import { asUserId, getBus } from '@baseline/contracts';
import { fetchRuntimeConfig, loadRemoteModule, type RuntimeConfig } from './loadRemote';
import './styles.css';

type RemoteApp = ComponentType<ShellRuntimeProps>;

type Route = 'people' | 'delivery';

const USERS = [
  { id: asUserId('user-alex'), name: 'Alex Planner' },
  { id: asUserId('user-sam'), name: 'Sam Lead' },
];

class RemoteErrorBoundary extends Component<
  { name: string; children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="remote-fallback">
          <h2>{this.props.name} unavailable</h2>
          <p>{this.state.error.message}</p>
          <p className="muted">
            The shell is still running. Fix the remote URL in{' '}
            <code>/config.json</code> or turn off “Break remote”.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    fetchRuntimeConfig()
      .then(setConfig)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Config load failed'),
      );
  };

  useEffect(() => {
    reload();
  }, []);

  return { config, error, reload };
}

export default function ShellApp() {
  const { config, error, reload } = useRuntimeConfig();
  const [route, setRoute] = useState<Route>('people');
  const [currency, setCurrency] = useState<DisplayCurrency>('EUR');
  const [userId, setUserId] = useState(USERS[0]!.id);
  const [breakRemote, setBreakRemote] = useState<'people' | 'delivery' | null>(
    null,
  );

  const user = USERS.find((u) => u.id === userId) ?? USERS[0]!;

  useEffect(() => {
    getBus().emit('baseline:shell-context', { currency, user });
  }, [currency, user]);

  const effectiveConfig = useMemo(() => {
    if (!config) return null;
    const next: RuntimeConfig = {
      remotes: { ...config.remotes },
      breakRemote,
    };
    if (breakRemote === 'people') {
      next.remotes.people = '/people/assets/remoteEntry.BROKEN.js';
    }
    if (breakRemote === 'delivery') {
      next.remotes.delivery = '/delivery/assets/remoteEntry.BROKEN.js';
    }
    return next;
  }, [config, breakRemote]);

  const PeopleRemote = useMemo(() => {
    if (!effectiveConfig) return null;
    const url = effectiveConfig.remotes.people;
    return lazy(async () => {
      const mod = await loadRemoteModule<{ default: RemoteApp }>(
        url,
        'people',
        './App',
      );
      return { default: mod.default ?? (mod as unknown as RemoteApp) };
    });
  }, [effectiveConfig?.remotes.people]);

  const DeliveryRemote = useMemo(() => {
    if (!effectiveConfig) return null;
    const url = effectiveConfig.remotes.delivery;
    return lazy(async () => {
      const mod = await loadRemoteModule<{ default: RemoteApp }>(
        url,
        'delivery',
        './App',
      );
      return { default: mod.default ?? (mod as unknown as RemoteApp) };
    });
  }, [effectiveConfig?.remotes.delivery]);

  if (error) {
    return <div className="shell-error">{error}</div>;
  }
  if (!effectiveConfig || !PeopleRemote || !DeliveryRemote) {
    return <div className="shell-loading">Loading shell configuration…</div>;
  }

  const panels: { route: Route; name: string; Remote: RemoteApp }[] = [
    { route: 'people', name: 'People', Remote: PeopleRemote },
    { route: 'delivery', name: 'Delivery', Remote: DeliveryRemote },
  ];

  return (
    <div className="shell">
      <header className="shell-bar">
        <div className="brand">
          <span className="mark">Baseline</span>
          <span className="tagline">Planning Suite</span>
        </div>
        <nav>
          <button
            type="button"
            className={route === 'people' ? 'active' : undefined}
            onClick={() => setRoute('people')}
          >
            People
          </button>
          <button
            type="button"
            className={route === 'delivery' ? 'active' : undefined}
            onClick={() => setRoute('delivery')}
          >
            Delivery
          </button>
        </nav>
        <div className="shell-controls">
          <label>
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
          <label>
            User
            <select
              value={userId}
              onChange={(e) => setUserId(asUserId(e.target.value))}
            >
              {USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Break remote
            <select
              value={breakRemote ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setBreakRemote(v === '' ? null : (v as 'people' | 'delivery'));
              }}
            >
              <option value="">None</option>
              <option value="people">People</option>
              <option value="delivery">Delivery</option>
            </select>
          </label>
          <label>
            Config
            <button type="button" className="ghost" onClick={reload}>
              Reload
            </button>
          </label>
        </div>
      </header>

      {/*
        Both remotes stay mounted so a change published by one reaches the other
        without a reload; navigation only changes which panel is visible.
      */}
      <main className="shell-main">
        {panels.map(({ route: panelRoute, name, Remote }) => (
          <section
            key={panelRoute}
            className="shell-panel"
            hidden={route !== panelRoute}
          >
            <RemoteErrorBoundary
              name={name}
              resetKey={effectiveConfig.remotes[panelRoute]}
            >
              <Suspense
                fallback={<div className="shell-loading">Loading {name}…</div>}
              >
                <Remote currency={currency} user={user} />
              </Suspense>
            </RemoteErrorBoundary>
          </section>
        ))}
      </main>
    </div>
  );
}
