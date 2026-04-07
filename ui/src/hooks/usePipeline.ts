import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSSE } from '../api/sse';
import { api } from '../api/client';
import type { PipelineProject, PipelineLogEntry, PipelineStage, PipelineScene, WorkbenchEvent, ModelOverrides } from '../types';

export function usePipeline(projectId?: string) {
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [current, setCurrent] = useState<PipelineProject | null>(null);
  const [logs, setLogs] = useState<PipelineLogEntry[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Fetch project list
  const refreshList = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  // Fetch specific project
  const refreshProject = useCallback((id: string) => {
    api.getProject(id).then((p) => {
      setCurrent(p);
      setLogs(p.logs);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    refreshList();
    if (projectId) refreshProject(projectId);

    cleanupRef.current = connectSSE((event: WorkbenchEvent) => {
      if (event.type === 'pipeline_created') {
        refreshList();
      } else if (
        event.type === 'pipeline_stage' ||
        event.type === 'pipeline_artifact' ||
        event.type === 'pipeline_complete' ||
        event.type === 'pipeline_error' ||
        event.type === 'pipeline_paused' ||
        event.type === 'pipeline_resumed' ||
        event.type === 'pipeline_scene_review'
      ) {
        const payload = event.payload as { projectId: string };
        if (!projectId || payload.projectId === projectId) {
          refreshProject(payload.projectId);
          refreshList();
        }
      } else if (event.type === 'pipeline_log') {
        const payload = event.payload as { projectId: string; entry: PipelineLogEntry };
        if (!projectId || payload.projectId === projectId) {
          setLogs((prev) => [...prev, payload.entry]);
        }
      }
    });

    return () => { cleanupRef.current?.(); };
  }, [projectId, refreshList, refreshProject]);

  const createProject = useCallback(async (topic: string, title?: string, qualityTier?: 'free' | 'balanced' | 'premium') => {
    const p = await api.createProject(topic, title, qualityTier);
    refreshList();
    return p;
  }, [refreshList]);

  const startPipeline = useCallback(async (id: string, videoFilePath?: string) => {
    await api.startPipeline(id, videoFilePath);
  }, []);

  const stopPipeline = useCallback(async (id: string) => {
    await api.stopPipeline(id);
  }, []);

  const retryStage = useCallback(async (id: string, stage: PipelineStage) => {
    await api.retryStage(id, stage);
  }, []);

  const regenerateScene = useCallback(async (id: string, sceneId: string) => {
    return api.regenerateScene(id, sceneId);
  }, []);

  const resumePipeline = useCallback(async (id: string) => {
    await api.resumePipeline(id);
  }, []);

  const updateScript = useCallback(async (id: string, scriptText: string) => {
    const p = await api.updateScript(id, scriptText);
    setCurrent(p);
    return p;
  }, []);

  const updateScenes = useCallback(async (id: string, scenes: PipelineScene[]) => {
    const p = await api.updateScenes(id, scenes);
    setCurrent(p);
    return p;
  }, []);

  const approveScene = useCallback(async (id: string, sceneId: string) => {
    const p = await api.approveScene(id, sceneId);
    setCurrent(p);
    return p;
  }, []);

  const qaOverride = useCallback(async (id: string, feedback?: string) => {
    const p = await api.qaOverride(id, feedback);
    setCurrent(p);
    return p;
  }, []);

  const approveReferenceImages = useCallback(async (id: string) => {
    const p = await api.approveReferenceImages(id);
    setCurrent(p);
    return p;
  }, []);

  const rejectScene = useCallback(async (id: string, sceneId: string) => {
    const p = await api.rejectScene(id, sceneId);
    setCurrent(p);
    return p;
  }, []);

  const setStyleProfile = useCallback(async (id: string, data: { pastedText?: string; styleProfile?: any; topic?: string }) => {
    const p = await api.setStyleProfile(id, data);
    setCurrent(p);
    return p;
  }, []);

  const updateModelOverrides = useCallback(async (id: string, overrides: ModelOverrides) => {
    const p = await api.updateModelOverrides(id, overrides);
    setCurrent(p);
    return p;
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await api.deleteProject(id);
    refreshList();
  }, [refreshList]);

  const exportProject = useCallback(async (id: string) => {
    return api.exportProject(id);
  }, []);

  const importProject = useCallback(async (bundle: Record<string, any>) => {
    const p = await api.importProject(bundle);
    refreshList();
    return p;
  }, [refreshList]);

  return {
    projects,
    current,
    logs,
    createProject,
    startPipeline,
    stopPipeline,
    retryStage,
    regenerateScene,
    resumePipeline,
    updateScript,
    updateScenes,
    approveScene,
    rejectScene,
    setStyleProfile,
    updateModelOverrides,
    qaOverride,
    approveReferenceImages,
    deleteProject,
    exportProject,
    importProject,
    refreshList,
    refreshProject,
  };
}
