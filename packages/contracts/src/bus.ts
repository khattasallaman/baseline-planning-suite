import type { BaselineEventMap } from './types';
import { BASELINE_CHANNEL } from './types';

type Handler<K extends keyof BaselineEventMap> = (
  detail: BaselineEventMap[K],
) => void;

declare global {
  interface Window {
    __BASELINE_BUS__?: BaselineBus;
  }
}

export class BaselineBus {
  private readonly channel: BroadcastChannel | null;
  private readonly handlers = new Map<
    string,
    Set<Handler<keyof BaselineEventMap>>
  >();

  constructor() {
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(BASELINE_CHANNEL)
        : null;

    this.channel?.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as {
        type: keyof BaselineEventMap;
        detail: unknown;
      };
      if (!data?.type) return;
      this.emitLocal(
        data.type,
        data.detail as BaselineEventMap[typeof data.type],
      );
    });
  }

  on<K extends keyof BaselineEventMap>(type: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<keyof BaselineEventMap>);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as Handler<keyof BaselineEventMap>);
    };
  }

  emit<K extends keyof BaselineEventMap>(
    type: K,
    detail: BaselineEventMap[K],
  ): void {
    this.emitLocal(type, detail);
    this.channel?.postMessage({ type, detail });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    }
  }

  private emitLocal<K extends keyof BaselineEventMap>(
    type: K,
    detail: BaselineEventMap[K],
  ): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<K>)(detail);
    }
  }
}

export function getBus(): BaselineBus {
  if (typeof window === 'undefined') {
    return new BaselineBus();
  }
  if (!window.__BASELINE_BUS__) {
    window.__BASELINE_BUS__ = new BaselineBus();
  }
  return window.__BASELINE_BUS__;
}
