import { useEffect, useRef, useCallback, useState } from 'react';
import { logger } from '../lib/logger';

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DraftEnvelope<T> {
  data: T;
  savedAt: number;
}

/**
 * Auto-save content to localStorage with debounce.
 * Wraps stored data with a timestamp; drafts older than 7 days are discarded on load.
 * Returns: [savedContent, setSavedContent, hasDraft, clearDraft]
 */
export function useAutoSave<T>(
  key: string,
  initialValue: T,
  debounceMs = 500,
): [T, (val: T) => void, boolean, () => void] {
  const storageKey = `ai-video-draft:${key}`;

  // Check for existing draft on mount
  const [hasDraft, setHasDraft] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return false;
      const parsed = JSON.parse(raw);
      // Evict expired drafts
      if (parsed && typeof parsed === 'object' && 'savedAt' in parsed) {
        if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
          localStorage.removeItem(storageKey);
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  });

  const [value, setValueState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        // Support new envelope format and legacy raw format
        if (parsed && typeof parsed === 'object' && 'savedAt' in parsed && 'data' in parsed) {
          if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
            localStorage.removeItem(storageKey);
            return initialValue;
          }
          logger.debug('storage', 'autosave_restored', { key: storageKey });
          return (parsed as DraftEnvelope<T>).data;
        }
        // Legacy format (raw T) — migrate on next save
        logger.debug('storage', 'autosave_restored', { key: storageKey });
        return parsed as T;
      }
    } catch { /* ignore */ }
    return initialValue;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue = useCallback((val: T) => {
    setValueState(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = { data: val, savedAt: Date.now() };
        localStorage.setItem(storageKey, JSON.stringify(envelope));
        setHasDraft(true);
        logger.debug('storage', 'autosave', { key: storageKey });
      } catch (err) {
        logger.warn('storage', 'autosave_failed', { key: storageKey, error: err instanceof Error ? err.message : String(err) });
      }
    }, debounceMs);
  }, [storageKey, debounceMs]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    setHasDraft(false);
  }, [storageKey]);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasDraft) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDraft]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return [value, setValue, hasDraft, clearDraft];
}

/** Remove all localStorage drafts associated with a given project ID */
export function clearDraftsForProject(projectId: string): void {
  const prefix = `ai-video-draft:`;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix) && key.includes(projectId)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
  if (keysToRemove.length > 0) {
    logger.debug('storage', 'drafts_cleared_for_project', { projectId, count: keysToRemove.length });
  }
}
