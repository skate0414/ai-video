import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../context/ProjectContext';
import type { PipelineStage } from '../types';

const STAGE_TO_PAGE: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: 'style',
  STYLE_EXTRACTION: 'style',
  RESEARCH: 'script',
  NARRATIVE_MAP: 'script',
  SCRIPT_GENERATION: 'script',
  QA_REVIEW: 'script',
  TEMPORAL_PLANNING: 'script',
  STORYBOARD: 'storyboard',
  VIDEO_IR_COMPILE: 'storyboard',
  REFERENCE_IMAGE: 'storyboard',
  KEYFRAME_GEN: 'storyboard',
  VIDEO_GEN: 'production',
  TTS: 'production',
  ASSEMBLY: 'production',
  REFINEMENT: 'production',
};

/**
 * Redirect to the smart target page when required prerequisite stages
 * have not been completed yet.
 *
 * Returns `false` while the project context is still loading (callers should
 * render nothing), and `true` once all prerequisites are met.
 */
export function usePageGuard(requiredStages: readonly PipelineStage[]): boolean {
  const { current } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const loading = !current;
  const ready =
    !!current &&
    requiredStages.every(s => current.stageStatus?.[s] === 'completed');

  useEffect(() => {
    if (loading || ready) return;

    // Find the first incomplete required stage and navigate to its page
    const firstIncomplete = requiredStages.find(
      s => current.stageStatus?.[s] !== 'completed',
    );
    const target = firstIncomplete ? STAGE_TO_PAGE[firstIncomplete] : 'style';
    navigate(`/${projectId}/${target}`, { replace: true });
  }, [current, loading, ready, requiredStages, projectId, navigate]);

  return ready;
}
