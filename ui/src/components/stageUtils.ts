import type { PipelineStage, ProcessStatus } from '../types';

const STAGE_LABEL: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估', STYLE_EXTRACTION: '风格提取',
  RESEARCH: '深度调研', NARRATIVE_MAP: '叙事地图',
  SCRIPT_GENERATION: '脚本生成', QA_REVIEW: '质量审核',
  TEMPORAL_PLANNING: '时间规划', VIDEO_IR_COMPILE: '视频编译',
  STORYBOARD: '分镜设计', REFERENCE_IMAGE: '参考图', KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频合成', REFINEMENT: '精修',
};

/**
 * Derive the "active" stage from a group of stages:
 * error > processing > first-pending > last-completed
 */
export function deriveActiveStage(
  stages: readonly PipelineStage[],
  stageStatus: Record<PipelineStage, ProcessStatus>,
): { stageName: PipelineStage; stageLabel: string; status: ProcessStatus } {
  const ss = stageStatus ?? {} as Record<PipelineStage, ProcessStatus>;
  const errored = stages.find(s => ss[s] === 'error');
  if (errored) return { stageName: errored, stageLabel: STAGE_LABEL[errored] ?? errored, status: 'error' };
  const processing = stages.find(s => ss[s] === 'processing');
  if (processing) return { stageName: processing, stageLabel: STAGE_LABEL[processing] ?? processing, status: 'processing' };
  const firstPending = stages.find(s => ss[s] === 'pending');
  if (firstPending) {
    const anyCompleted = stages.some(s => ss[s] === 'completed');
    if (anyCompleted) return { stageName: firstPending, stageLabel: STAGE_LABEL[firstPending] ?? firstPending, status: 'pending' };
    return { stageName: stages[0], stageLabel: STAGE_LABEL[stages[0]] ?? stages[0], status: 'pending' };
  }
  const last = stages[stages.length - 1];
  return { stageName: last, stageLabel: STAGE_LABEL[last] ?? last, status: 'completed' };
}
