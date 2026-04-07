import { createContext, useContext } from 'react';
import type { usePipeline } from '../hooks/usePipeline';

export type ProjectContextValue = ReturnType<typeof usePipeline>;

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const ProjectProvider = ProjectContext.Provider;

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
