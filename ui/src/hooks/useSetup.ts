import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface SetupStatus {
  needsSetup: boolean;
  dataDir: string;
  hasApiKey: boolean;
  accountCount: number;
  ffmpegAvailable: boolean;
  playwrightAvailable?: boolean;
  nodeVersion?: string;
  platform?: string;
}

export function useSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.getSetupStatus()
      .then(setStatus)
      .catch(() => {
        // Backend not reachable, skip setup
        setDismissed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const dismiss = () => setDismissed(true);

  const showSetup = !loading && !dismissed && status?.needsSetup === true;

  return { status, loading, showSetup, dismiss };
}
