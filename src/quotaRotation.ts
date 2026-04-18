/* ------------------------------------------------------------------ */
/*  quotaRotation — shared quota-aware rotation for all providers      */
/*  Provides unified try-with-rotation for both API and browser        */
/*  resources, plus per-resource per-capability exhaustion tracking.    */
/* ------------------------------------------------------------------ */

import { quotaBus, type QuotaCapability } from './quotaBus.js';
import type { ResourceManager } from './resourceManager.js';
import type { AiResource, ProviderId } from './types.js';

/* ---- Shared quota error detection ---- */

/**
 * Determine whether an error indicates quota/rate-limit exhaustion.
 * Used by all adapters (chat, API, video) for consistent detection.
 */
export function isQuotaError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as any;
    if (e.isQuotaError) return true;
    if (e.status === 429 || e.status === 503) return true;
    const msg = (e.message ?? '').toLowerCase();
    if (/quota|rate limit|resource_exhausted|usage cap|free plan limit|too many requests|insufficient credits|you've reached|请求过于频繁|已达到.*使用上限/.test(msg)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether a response text string contains quota-exhaustion signals.
 */
export function hasQuotaSignal(text: string): boolean {
  return /free plan limit|usage cap|quota|limit resets|image generation requests|rate limit|too many requests/i.test(text);
}

/* ---- Per-resource per-capability exhaustion tracker ---- */

/**
 * Tracks exhaustion at the (resourceId, capability) granularity.
 *
 * This is finer than ResourceManager's global `quotaExhausted` flag,
 * allowing an account's *text* capability to remain active when only
 * its *image* capability is depleted.
 */
export class CapabilityQuotaTracker {
  /** Set of `${resourceId}:${capability}` keys currently exhausted. */
  private exhausted = new Set<string>();
  /** Timestamp when each key was marked exhausted (for auto-reset). */
  private exhaustedAt = new Map<string, number>();
  /** Auto-reset window in ms.  Default 24 h. */
  resetWindowMs = 24 * 60 * 60 * 1000;

  private key(resourceId: string, capability: QuotaCapability): string {
    return `${resourceId}:${capability}`;
  }

  /** Mark a specific resource's capability as exhausted. */
  markExhausted(resourceId: string, capability: QuotaCapability, provider?: string): void {
    const k = this.key(resourceId, capability);
    this.exhausted.add(k);
    this.exhaustedAt.set(k, Date.now());
    console.log(`[QuotaRotation] 🔴 ${resourceId}/${capability} exhausted`);

    if (provider) {
      quotaBus.emit({
        provider,
        accountId: resourceId,
        capability,
        exhausted: true,
        reason: `Resource ${resourceId} capability '${capability}' exhausted`,
      });
    }
  }

  /** Check if a specific resource's capability is exhausted. */
  isExhausted(resourceId: string, capability: QuotaCapability): boolean {
    const k = this.key(resourceId, capability);
    if (!this.exhausted.has(k)) return false;

    // Auto-reset check
    const at = this.exhaustedAt.get(k) ?? 0;
    if (this.resetWindowMs > 0 && Date.now() - at >= this.resetWindowMs) {
      this.exhausted.delete(k);
      this.exhaustedAt.delete(k);
      console.log(`[QuotaRotation] 🟢 ${resourceId}/${capability} auto-reset after ${Math.round((Date.now() - at) / 3600000)}h`);
      return false;
    }
    return true;
  }

  /** Reset a specific resource's capability. */
  reset(resourceId: string, capability: QuotaCapability): void {
    const k = this.key(resourceId, capability);
    this.exhausted.delete(k);
    this.exhaustedAt.delete(k);
  }

  /** Reset all tracked exhaustion state. */
  resetAll(): void {
    this.exhausted.clear();
    this.exhaustedAt.clear();
  }

  /** Count how many resources for a given capability are still available. */
  availableCount(resources: readonly AiResource[], capability: QuotaCapability): number {
    return resources.filter(
      (r) => !r.quotaExhausted && r.capabilities[capability] && !this.isExhausted(r.id, capability),
    ).length;
  }

  /** Check if all resources for a capability are exhausted. */
  allExhausted(resources: readonly AiResource[], capability: QuotaCapability): boolean {
    return this.availableCount(resources, capability) === 0;
  }
}

/* ---- Try-with-rotation for API resources ---- */

export interface RotationOptions<T> {
  /** ResourceManager instance. */
  resourceManager: ResourceManager;
  /** Which capability to rotate on. */
  capability: QuotaCapability;
  /** Preferred provider (optional). */
  preferredProvider?: ProviderId;
  /** The operation to try with each resource. Receives the resource. */
  operation: (resource: AiResource) => Promise<T>;
  /** Custom quota error detection (defaults to isQuotaError). */
  isQuotaErr?: (err: unknown) => boolean;
  /** Maximum number of resources to try before giving up. */
  maxAttempts?: number;
}

/**
 * Pick resources one-by-one via round-robin and attempt the operation.
 * On quota error, marks the resource as exhausted and tries the next.
 * Returns the first successful result, or null if all resources are exhausted.
 *
 * Suitable for **API-based** resources where the caller controls
 * which key/credential is used.  For browser-based resources the
 * rotation happens inside the Workbench processLoop — use
 * `CapabilityQuotaTracker` directly instead.
 */
export async function tryWithRotation<T>(opts: RotationOptions<T>): Promise<{ result: T; resource: AiResource } | null> {
  const { resourceManager, capability, preferredProvider, operation } = opts;
  const checkQuota = opts.isQuotaErr ?? isQuotaError;
  const maxAttempts = opts.maxAttempts ?? 10;

  const tried = new Set<string>();

  for (let i = 0; i < maxAttempts; i++) {
    const resource = resourceManager.pickResource(capability as any, preferredProvider);
    if (!resource || tried.has(resource.id)) {
      // No more untried resources
      break;
    }
    tried.add(resource.id);

    try {
      const result = await operation(resource);
      return { result, resource };
    } catch (err) {
      if (checkQuota(err)) {
        resourceManager.markQuotaExhausted(resource.id);
        quotaBus.emit({
          provider: resource.provider,
          accountId: resource.id,
          capability,
          exhausted: true,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      throw err; // non-quota errors propagate immediately
    }
  }

  return null; // all resources exhausted
}

/* ---- Singleton tracker instance ---- */

/** Global per-capability quota tracker shared by all adapters. */
export const capabilityQuota = new CapabilityQuotaTracker();
