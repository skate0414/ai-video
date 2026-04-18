import { useCallback, useRef, useState } from 'react';

/**
 * Wraps an async callback with a busy guard to prevent double submission.
 * Returns [wrappedFn, isBusy].
 */
export function useAsyncAction<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): [(...args: Args) => Promise<void>, boolean] {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const wrapped = useCallback(async (...args: Args) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn(...args);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [fn]);

  return [wrapped, busy];
}
