/* ------------------------------------------------------------------ */
/*  QuotaBus – unified quota exhaustion event system                   */
/*  All subsystems (text, image, video) broadcast and listen to quota  */
/*  events through this single bus, enabling cross-system awareness.   */
/* ------------------------------------------------------------------ */

export type QuotaCapability = 'text' | 'image' | 'video';

export interface QuotaEvent {
  /** Provider that ran out of quota (e.g. 'chatgpt', 'gemini', 'seedance') */
  provider: string;
  /** Account ID if applicable */
  accountId?: string;
  /** Which capability is exhausted */
  capability: QuotaCapability;
  /** Whether quota is exhausted (true) or restored (false) */
  exhausted: boolean;
  /** Human-readable reason */
  reason?: string;
  /** ISO timestamp */
  timestamp: string;
}

export type QuotaListener = (event: QuotaEvent) => void;

/**
 * Singleton quota event bus.
 * Usage:
 *   quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true, ... });
 *   quotaBus.on((event) => { if (event.capability === 'image') switchProvider(); });
 *   quotaBus.isExhausted('chatgpt', 'image'); // check current state
 */
class QuotaBusImpl {
  private listeners: QuotaListener[] = [];
  private state = new Map<string, QuotaEvent>();

  private key(provider: string, capability: QuotaCapability): string {
    return `${provider}:${capability}`;
  }

  /** Register a listener for quota events. Returns unsubscribe function. */
  on(fn: QuotaListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  /** Broadcast a quota event to all listeners. */
  emit(event: Omit<QuotaEvent, 'timestamp'>): void {
    const fullEvent: QuotaEvent = { ...event, timestamp: new Date().toISOString() };
    const k = this.key(event.provider, event.capability);

    if (event.exhausted) {
      this.state.set(k, fullEvent);
    } else {
      this.state.delete(k);
    }

    console.log(`[QuotaBus] ${event.exhausted ? '🔴' : '🟢'} ${event.provider}/${event.capability}: ${event.reason ?? (event.exhausted ? 'exhausted' : 'restored')}`);
    for (const fn of this.listeners) {
      try { fn(fullEvent); } catch (err) {
        console.warn('[QuotaBus] Listener error:', err instanceof Error ? err.message : err);
      }
    }
  }

  /** Check if a specific provider/capability combination is exhausted. */
  isExhausted(provider: string, capability: QuotaCapability): boolean {
    return this.state.has(this.key(provider, capability));
  }

  /** Get all exhausted capabilities for a provider. */
  getExhaustedFor(provider: string): QuotaCapability[] {
    const result: QuotaCapability[] = [];
    for (const [k, _] of this.state) {
      if (k.startsWith(`${provider}:`)) {
        result.push(k.split(':')[1] as QuotaCapability);
      }
    }
    return result;
  }

  /** Get all current exhaustion states. */
  getAll(): QuotaEvent[] {
    return [...this.state.values()];
  }

  /** Reset a specific provider/capability (e.g. after cooldown). */
  reset(provider: string, capability: QuotaCapability): void {
    this.emit({ provider, capability, exhausted: false, reason: 'manual reset' });
  }

  /** Reset all quota states. */
  resetAll(): void {
    const keys = [...this.state.keys()];
    for (const k of keys) {
      const [provider, capability] = k.split(':') as [string, QuotaCapability];
      this.emit({ provider, capability, exhausted: false, reason: 'reset all' });
    }
  }
}

/** Global singleton quota bus instance. */
export const quotaBus = new QuotaBusImpl();
