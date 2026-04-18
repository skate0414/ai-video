import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSSE } from '../api/sse';
import { api } from '../api/client';
import { logger } from '../lib/logger';
import { clearDraftsForProject } from './useAutoSave';
import type { PipelineProject, PipelineLogEntry, PipelineStage, PipelineScene, WorkbenchEvent, ModelOverrides } from '../types';
import { SSE_EVENT } from '../types';

export function usePipeline(projectId?: string) {
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [current, setCurrent] = useState<PipelineProject | null>(null);
  const [logs, setLogs] = useState<PipelineLogEntry[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Fetch project list
  const refreshList = useCallback(() => {
    api.listProjects().then(setProjects).catch(err => logger.error('api', 'list_projects_failed', { error: err instanceof Error ? err.message : String(err) }));
  }, []);

  // Fetch specific project
  const refreshProject = useCallback((id: string) => {
    api.getProject(id).then((p) => {
      setCurrent(p);
      setLogs(p.logs ?? []);
    }).catch(err => logger.error('api', 'get_project_failed', { projectId: id, error: err instanceof Error ? err.message : String(err) }));
  }, []);

  useEffect(() => {
    refreshList();
    if (projectId) refreshProject(projectId);

    cleanupRef.current = connectSSE((event: WorkbenchEvent) => {
      if (event.type === SSE_EVENT.CREATED) {
        refreshList();
      } else if (
        event.type === SSE_EVENT.STAGE ||
        event.type === SSE_EVENT.ARTIFACT ||
        event.type === SSE_EVENT.COMPLETE ||
        event.type === SSE_EVENT.ERROR ||
        event.type === SSE_EVENT.PAUSED ||
        event.type === SSE_EVENT.RESUMED ||
        event.type === SSE_EVENT.SCENE_REVIEW
      ) {
        const payload = event.payload as { projectId: string };
        if (!projectId || payload.projectId === projectId) {
          refreshProject(payload.projectId);
          refreshList();
        }
        if (event.type === SSE_EVENT.COMPLETE || event.type === SSE_EVENT.ERROR) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const title = event.type === SSE_EVENT.COMPLETE ? '🎬 视频生成完成' : '❌ 视频生成失败';
            const body = event.type === SSE_EVENT.COMPLETE ? '您的视频已生成完毕，可以下载了！' : '流水线遇到错误，请查看详情。';
            new Notification(title, { body });
          }
        }
      } else if (event.type === SSE_EVENT.LOG) {
        const payload = event.payload as { projectId: string; entry: PipelineLogEntry };
        if (!projectId || payload.projectId === projectId) {
          setLogs((prev) => [...prev, payload.entry]);
        }
      }
    });

    return () => { cleanupRef.current?.(); };
  }, [projectId, refreshList, refreshProject]);

  const createProject = useCallback(async (topic: string, title?: string) => {
    logger.info('user', 'create_project', { topic, title });
    const p = await api.createProject(topic, title);
    refreshList();
    return p;
  }, [refreshList]);

  const startPipeline = useCallback(async (id: string, videoFilePath?: string) => {
    logger.info('user', 'start_pipeline', { projectId: id, hasVideo: !!videoFilePath });
    await api.startPipeline(id, videoFilePath);
  }, []);

  const stopPipeline = useCallback(async (id: string) => {
    logger.info('user', 'stop_pipeline', { projectId: id });
    await api.stopPipeline(id);
  }, []);

  const retryStage = useCallback(async (id: string, stage: PipelineStage, directive?: string) => {
    logger.info('user', 'retry_stage', { projectId: id, stage, hasDirective: !!directive });
    await api.retryStage(id, stage, directive);
  }, []);

  const regenerateScene = useCallback(async (id: string, sceneId: string, feedback?: string) => {
    logger.info('user', 'regenerate_scene', { projectId: id, sceneId, hasFeedback: !!feedback });
    return api.regenerateScene(id, sceneId, feedback);
  }, []);

  const resumePipeline = useCallback(async (id: string) => {
    logger.info('user', 'resume_pipeline', { projectId: id });
    await api.resumePipeline(id);
  }, []);

  const updateScript = useCallback(async (id: string, scriptText: string) => {
    logger.info('user', 'update_script', { projectId: id, length: scriptText.length });
    const p = await api.updateScript(id, scriptText);
    setCurrent(p);
    return p;
  }, []);

  const updateScenes = useCallback(async (id: string, scenes: PipelineScene[]) => {
    logger.info('user', 'update_scenes', { projectId: id, sceneCount: scenes.length });
    const p = await api.updateScenes(id, scenes);
    setCurrent(p);
    return p;
  }, []);

  const approveScene = useCallback(async (id: string, sceneId: string) => {
    logger.info('user', 'approve_scene', { projectId: id, sceneId });
    const p = await api.approveScene(id, sceneId);
    setCurrent(p);
    return p;
  }, []);

  const qaOverride = useCallback(async (id: string, feedback?: string) => {
    logger.info('user', 'qa_override', { projectId: id, hasFeedback: !!feedback });
    const p = await api.qaOverride(id, feedback);
    setCurrent(p);
    return p;
  }, []);

  const approveReferenceImages = useCallback(async (id: string) => {
    logger.info('user', 'approve_reference_images', { projectId: id });
    const p = await api.approveReferenceImages(id);
    setCurrent(p);
    return p;
  }, []);

  const rejectScene = useCallback(async (id: string, sceneId: string, reason?: string) => {
    logger.info('user', 'reject_scene', { projectId: id, sceneId, hasReason: !!reason });
    const p = await api.rejectScene(id, sceneId, reason);
    setCurrent(p);
    return p;
  }, []);

  const setStyleProfile = useCallback(async (id: string, data: { pastedText?: string; styleProfile?: any; topic?: string }) => {
    logger.info('user', 'set_style_profile', { projectId: id, hasPastedText: !!data.pastedText, hasProfile: !!data.styleProfile });
    const p = await api.setStyleProfile(id, data);
    setCurrent(p);
    return p;
  }, []);

  const updateModelOverrides = useCallback(async (id: string, overrides: ModelOverrides) => {
    logger.info('user', 'update_model_overrides', { projectId: id, keys: Object.keys(overrides) });
    const p = await api.updateModelOverrides(id, overrides);
    setCurrent(p);
    return p;
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    logger.info('user', 'delete_project', { projectId: id });
    await api.deleteProject(id);
    clearDraftsForProject(id);
    refreshList();
  }, [refreshList]);

  const exportProject = useCallback(async (id: string) => {
    logger.info('user', 'export_project', { projectId: id });
    return api.exportProject(id);
  }, []);

  const importProject = useCallback(async (bundle: Record<string, any>) => {
    logger.info('user', 'import_project');
    const p = await api.importProject(bundle);
    refreshList();
    return p;
  }, [refreshList]);

  // ---- Refinement operations ----
  const uploadBgm = useCallback(async (id: string, file: File) => {
    logger.info('user', 'upload_bgm', { projectId: id, filename: file.name, size: file.size });
    return api.uploadBgm(id, file);
  }, []);

  const deleteBgm = useCallback(async (id: string) => {
    logger.info('user', 'delete_bgm', { projectId: id });
    return api.deleteBgm(id);
  }, []);

  const getBgmInfo = useCallback(async (id: string) => {
    return api.getBgmInfo(id);
  }, []);

  const getBgmStreamUrl = useCallback((id: string) => {
    return api.getBgmStreamUrl(id);
  }, []);

  const getRefineOptions = useCallback(async (id: string) => {
    return api.getRefineOptions(id);
  }, []);

  const getRefineProvenance = useCallback(async (id: string) => {
    return api.getRefineProvenance(id);
  }, []);

  const getRefineReferenceDefaults = useCallback(async (id: string) => {
    return api.getRefineReferenceDefaults(id);
  }, []);

  const updateRefineOptions = useCallback(async (id: string, options: import('../types').RefineOptions) => {
    logger.info('user', 'update_refine_options', { projectId: id });
    return api.updateRefineOptions(id, options);
  }, []);

  const reAssemble = useCallback(async (id: string) => {
    logger.info('user', 're_assemble', { projectId: id });
    const result = await api.reAssemble(id);
    // Refresh the project after triggering re-assembly
    refreshProject(id);
    return result;
  }, [refreshProject]);

  // ---- BGM Library ----
  const listBgmLibrary = useCallback(async () => {
    return api.listBgmLibrary();
  }, []);

  const getBgmLibraryStreamUrl = useCallback((filename: string) => {
    return api.getBgmLibraryStreamUrl(filename);
  }, []);

  const uploadToBgmLibrary = useCallback(async (file: File) => {
    logger.info('user', 'upload_to_bgm_library', { filename: file.name, size: file.size });
    return api.uploadToBgmLibrary(file);
  }, []);

  const importBgmFromLibrary = useCallback(async (projectId: string, filename: string) => {
    logger.info('user', 'import_bgm_from_library', { projectId, filename });
    return api.importBgmFromLibrary(projectId, filename);
  }, []);

  const openPixabayBrowser = useCallback(async (mood?: string) => {
    logger.info('user', 'open_pixabay_browser', { mood });
    const result = await api.openPixabayBrowser(mood);
    if (!result.ok && result.fallbackUrl) {
      window.open(result.fallbackUrl, '_blank');
    }
    return result;
  }, []);

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
    // Refinement operations
    uploadBgm,
    deleteBgm,
    getBgmInfo,
    getBgmStreamUrl,
    getRefineOptions,
    getRefineProvenance,
    getRefineReferenceDefaults,
    updateRefineOptions,
    reAssemble,
    // BGM Library
    listBgmLibrary,
    getBgmLibraryStreamUrl,
    uploadToBgmLibrary,
    importBgmFromLibrary,
    openPixabayBrowser,
  };
}
