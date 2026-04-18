import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSSE } from '../api/sse';
import { api } from '../api/client';
import { logger } from '../lib/logger';
import type { WorkbenchState, WorkbenchEvent } from '../types';
import { WB_EVENT } from '../types';

const EMPTY_STATE: WorkbenchState = {
  accounts: [],
  resources: [],
  tasks: [],
  isRunning: false,
  chatMode: 'new',
  providers: [],
  detectedModels: {},
  loginOpenAccountIds: [],
};

export function useWorkbench() {
  const [state, setState] = useState<WorkbenchState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Initial fetch
    api.getState().then((s) => { setState(s); logger.info('api', 'workbench_loaded'); }).catch(err => logger.error('api', 'workbench_load_failed', { error: err instanceof Error ? err.message : String(err) }));

    // SSE connection
    cleanupRef.current = connectSSE((event: WorkbenchEvent) => {
      setConnected(true);
      if (event.type === WB_EVENT.STATE) {
        setState(event.payload);
      } else {
        // For other events, refetch full state for simplicity
        api.getState().then(setState).catch(err => logger.error('api', 'workbench_refresh_failed', { error: err instanceof Error ? err.message : String(err) }));
      }
    });

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const refresh = useCallback(() => {
    api.getState().then(setState).catch(err => logger.error('api', 'workbench_refresh_failed', { error: err instanceof Error ? err.message : String(err) }));
  }, []);

  return { state, connected, refresh };
}
