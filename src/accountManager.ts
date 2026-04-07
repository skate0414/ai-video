import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Account, ProviderId } from './types.js';
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_LABELS } from './providers.js';

let counter = 0;

function uid(): string {
  return `acc_${Date.now()}_${++counter}`;
}

/**
 * Manages browser-profile accounts and round-robin rotation.
 *
 * Accounts are persisted to a JSON file so they survive server restarts.
 * On first launch, one default account is created for each provider.
 */
export class AccountManager {
  private accounts: Account[] = [];
  private savePath: string;
  private skipPersist: boolean;

  constructor(savePath?: string, skipSeed?: boolean) {
    this.savePath = savePath ?? join(process.cwd(), 'data', 'accounts.json');
    this.skipPersist = false;
    if (skipSeed) {
      // Test mode: start empty, no seeding, no reading from disk
      return;
    }
    this.load();
  }

  /* -------------------------------------------------------------- */
  /*  Persistence                                                   */
  /* -------------------------------------------------------------- */

  private load(): void {
    if (existsSync(this.savePath)) {
      try {
        const raw = readFileSync(this.savePath, 'utf-8');
        this.accounts = JSON.parse(raw) as Account[];
        return;
      } catch {
        // corrupted file – fall through to defaults
      }
    }
    // First launch: create one account per provider
    this.seedDefaults();
  }

  private persist(): void {
    const dir = dirname(this.savePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.savePath, JSON.stringify(this.accounts, null, 2));
  }

  private seedDefaults(): void {
    for (const p of BUILTIN_PROVIDER_IDS) {
      this.accounts.push({
        id: uid(),
        provider: p,
        label: BUILTIN_PROVIDER_LABELS[p],
        profileDir: join(process.cwd(), 'data', 'profiles', p),
        quotaExhausted: false,
      });
    }
    this.persist();
  }

  /* -------------------------------------------------------------- */
  /*  Public API                                                    */
  /* -------------------------------------------------------------- */

  all(): Account[] {
    return [...this.accounts];
  }

  /** Register a new account. */
  addAccount(provider: ProviderId, label: string, profileDir: string): Account {
    const account: Account = {
      id: uid(),
      provider,
      label,
      profileDir,
      quotaExhausted: false,
    };
    this.accounts.push(account);
    this.persist();
    return account;
  }

  /** Remove an account by id. */
  removeAccount(accountId: string): boolean {
    const idx = this.accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) return false;
    this.accounts.splice(idx, 1);
    this.persist();
    return true;
  }

  /** Get an account by id. */
  get(accountId: string): Account | undefined {
    return this.accounts.find((a) => a.id === accountId);
  }

  /**
   * Pick the best available account.
   *
   * Strategy:
   * 1. Prefer `preferredProvider` if specified and has available account.
   * 2. Fall back to any provider with available quota.
   * 3. Return undefined if all accounts exhausted.
   */
  pickAccount(preferredProvider?: ProviderId): Account | undefined {
    const available = this.accounts.filter((a) => !a.quotaExhausted);
    if (available.length === 0) return undefined;

    if (preferredProvider) {
      const preferred = available.find((a) => a.provider === preferredProvider);
      if (preferred) return preferred;
    }

    // Round-robin: return the first available
    return available[0];
  }

  /** Mark an account as quota-exhausted. */
  markQuotaExhausted(accountId: string): void {
    const account = this.get(accountId);
    if (!account) return;
    account.quotaExhausted = true;
    account.quotaResetAt = undefined;
    this.persist();
  }

  /** Reset quota for an account (e.g. after cooldown). */
  resetQuota(accountId: string): void {
    const account = this.get(accountId);
    if (!account) return;
    account.quotaExhausted = false;
    account.quotaResetAt = new Date().toISOString();
    this.persist();
  }

  /** Reset quota on all accounts. */
  resetAllQuotas(): void {
    for (const a of this.accounts) {
      a.quotaExhausted = false;
      a.quotaResetAt = new Date().toISOString();
    }
    this.persist();
  }

  /** How many accounts still have quota remaining. */
  availableCount(): number {
    return this.accounts.filter((a) => !a.quotaExhausted).length;
  }
}
