import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSSE } from '../api/sse';
import { api } from '../api/client';
import type { WorkbenchState, WorkbenchEvent } from '../types';

const EMPTY_STATE: WorkbenchState = {
  accounts: [],
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
    api.getState().then(setState).catch(console.error);

    // SSE connection
    cleanupRef.current = connectSSE((event: WorkbenchEvent) => {
      setConnected(true);
      if (event.type === 'state') {
        setState(event.payload);
      } else {
        // For other events, refetch full state for simplicity
        api.getState().then(setState).catch(console.error);
      }
    });

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const refresh = useCallback(() => {
    api.getState().then(setState).catch(console.error);
  }, []);

  return { state, connected, refresh };
}
