/* ------------------------------------------------------------------ */
/*  VideoProviderHealthCheck – periodically probes video generation    */
/*  providers for selector drift and availability.                    */
/*  Emits events on health changes so the UI can show warnings.       */
/* ------------------------------------------------------------------ */

import type { SiteAutomationConfig, SelectorHealth } from '../types.js';

export interface ProviderHealthStatus {
  providerId: string;
  label: string;
  siteUrl: string;
  /** Overall health: 'healthy' | 'degraded' | 'down' */
  status: 'healthy' | 'degraded' | 'down';
  /** 0-100 score based on selector reachability */
  healthScore: number;
  /** Selector names that failed all strategies */
  brokenSelectors: string[];
  /** ISO timestamp of last successful check */
  lastCheckedAt?: string;
  /** ISO timestamp of last healthy status */
  lastHealthyAt?: string;
  /** Error message if check itself failed */
  checkError?: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
}

export type HealthEventListener = (event: HealthEvent) => void;

export type HealthEvent =
  | { type: 'provider_health_changed'; payload: ProviderHealthStatus }
  | { type: 'provider_degraded'; payload: { providerId: string; brokenSelectors: string[]; recommendation: string } }
  | { type: 'provider_down'; payload: { providerId: string; error: string; recommendation: string } };

/**
 * VideoProviderHealthMonitor tracks the availability and selector status
 * of browser-based video providers (Seedance, Kling, etc.).
 */
export class VideoProviderHealthMonitor {
  private providers = new Map<string, ProviderHealthStatus>();
  private listeners: HealthEventListener[] = [];

  onEvent(fn: HealthEventListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(event: HealthEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  /**
   * Register a video provider for health tracking.
   */
  register(config: SiteAutomationConfig): void {
    if (!this.providers.has(config.id)) {
      this.providers.set(config.id, {
        providerId: config.id,
        label: config.label,
        siteUrl: config.siteUrl,
        status: 'healthy',
        healthScore: 100,
        brokenSelectors: [],
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Record the result of a selector probe for a provider.
   * Called after attempting to use a provider (successful or failed).
   */
  recordProbeResult(
    providerId: string,
    result: {
      success: boolean;
      brokenSelectors?: string[];
      healthScore?: number;
      error?: string;
    },
  ): ProviderHealthStatus | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const prevStatus = provider.status;
    const now = new Date().toISOString();
    provider.lastCheckedAt = now;

    if (result.success) {
      provider.consecutiveFailures = 0;
      provider.healthScore = result.healthScore ?? 100;
      provider.brokenSelectors = result.brokenSelectors ?? [];
      provider.checkError = undefined;
      provider.lastHealthyAt = now;

      if (provider.brokenSelectors.length > 0) {
        provider.status = 'degraded';
      } else {
        provider.status = 'healthy';
      }
    } else {
      provider.consecutiveFailures++;
      provider.checkError = result.error;
      provider.brokenSelectors = result.brokenSelectors ?? provider.brokenSelectors;
      provider.healthScore = result.healthScore ?? Math.max(0, provider.healthScore - 20);

      if (provider.consecutiveFailures >= 3) {
        provider.status = 'down';
      } else {
        provider.status = 'degraded';
      }
    }

    // Emit events on status changes
    if (provider.status !== prevStatus) {
      this.emit({ type: 'provider_health_changed', payload: { ...provider } });

      if (provider.status === 'degraded') {
        this.emit({
          type: 'provider_degraded',
          payload: {
            providerId,
            brokenSelectors: provider.brokenSelectors,
            recommendation: `视频提供者 ${provider.label} 部分选择器失效 (${provider.brokenSelectors.join(', ')})，` +
              `可能因网站更新导致。建议：1) 运行 debug:provider-dom 检查 2) 更新选择器配置 3) 切换到 API 模式`,
          },
        });
      }

      if (provider.status === 'down') {
        this.emit({
          type: 'provider_down',
          payload: {
            providerId,
            error: provider.checkError ?? 'Unknown error',
            recommendation: `视频提供者 ${provider.label} 已连续失败 ${provider.consecutiveFailures} 次，判定为不可用。` +
              `建议：1) 检查账号登录状态 2) 检查网站是否正常 3) 临时切换到 premium 质量等级使用 API 生成`,
          },
        });
      }
    }

    return { ...provider };
  }

  /**
   * Record a successful video generation for a provider.
   */
  recordSuccess(providerId: string): void {
    this.recordProbeResult(providerId, { success: true, healthScore: 100 });
  }

  /**
   * Record a failed video generation attempt.
   */
  recordFailure(providerId: string, error: string, brokenSelectors?: string[]): void {
    this.recordProbeResult(providerId, {
      success: false,
      error,
      brokenSelectors,
      healthScore: 0,
    });
  }

  /**
   * Get current health status for all registered providers.
   */
  getAll(): ProviderHealthStatus[] {
    return Array.from(this.providers.values()).map(p => ({ ...p }));
  }

  /**
   * Get status for a specific provider.
   */
  get(providerId: string): ProviderHealthStatus | undefined {
    const p = this.providers.get(providerId);
    return p ? { ...p } : undefined;
  }

  /**
   * Check if a provider is considered usable (healthy or degraded).
   */
  isUsable(providerId: string): boolean {
    const p = this.providers.get(providerId);
    if (!p) return true; // not tracked = assume usable
    return p.status !== 'down';
  }

  /**
   * Get a recommendation for which provider to use when one is down.
   */
  getRecommendation(requestedProviderId: string): {
    useProvider: string | null;
    useApi: boolean;
    reason: string;
  } {
    const requested = this.providers.get(requestedProviderId);

    // If requested is healthy, use it
    if (!requested || requested.status === 'healthy') {
      return { useProvider: requestedProviderId, useApi: false, reason: 'Provider is healthy' };
    }

    // If degraded, still try but warn
    if (requested.status === 'degraded') {
      return {
        useProvider: requestedProviderId,
        useApi: false,
        reason: `⚠️ ${requested.label} is degraded (${requested.brokenSelectors.join(', ')} broken)`,
      };
    }

    // Provider is down — find alternative
    const alternatives = Array.from(this.providers.values())
      .filter(p => p.providerId !== requestedProviderId && p.status !== 'down');

    if (alternatives.length > 0) {
      const best = alternatives.sort((a, b) => b.healthScore - a.healthScore)[0];
      return {
        useProvider: best.providerId,
        useApi: false,
        reason: `${requested.label} is down — switching to ${best.label}`,
      };
    }

    // No alternatives — recommend API
    return {
      useProvider: null,
      useApi: true,
      reason: `所有浏览器视频提供者不可用，建议切换到 premium 质量等级使用 Gemini Veo API`,
    };
  }

  /**
   * Generate a summary suitable for API responses.
   */
  toJSON(): Record<string, ProviderHealthStatus> {
    const result: Record<string, ProviderHealthStatus> = {};
    for (const [id, status] of this.providers) {
      result[id] = { ...status };
    }
    return result;
  }
}
