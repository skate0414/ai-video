import type { PipelineProject, PipelineStage } from './types';

export type DashboardStatus =
  | 'analysis'
  | 'scriptReview'
  | 'visualGenerating'
  | 'visualReview'
  | 'assembling'
  | 'completed'
  | 'error';

export const DASHBOARD_STATUS_META: Record<DashboardStatus, { label: string; badgeClass: string }> = {
  analysis: {
    label: '⚙️ 分析中',
    badgeClass: 'text-zinc-300 bg-zinc-700/40 border-zinc-600/40',
  },
  scriptReview: {
    label: '🟡 脚本待审核',
    badgeClass: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  },
  visualGenerating: {
    label: '⚙️ 视觉生成中',
    badgeClass: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
  },
  visualReview: {
    label: '🟡 视觉待审核',
    badgeClass: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  },
  assembling: {
    label: '⚙️ 组装中',
    badgeClass: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  },
  completed: {
    label: '✅ 完成',
    badgeClass: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  },
  error: {
    label: '❌ 出错',
    badgeClass: 'text-red-300 bg-red-500/10 border-red-500/30',
  },
};

const ALL_STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
  'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING', 'STORYBOARD', 'VIDEO_IR_COMPILE',
  'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
];

export function getDashboardStatus(project: PipelineProject): DashboardStatus {
  const ss = project.stageStatus ?? {} as Record<PipelineStage, string>;
  if (project.error || Object.values(ss).some((s) => s === 'error')) return 'error';
  if (ALL_STAGES.every((s) => ss[s] === 'completed')) return 'completed';

  if (project.isPaused && ['SCRIPT_GENERATION', 'QA_REVIEW'].includes(project.pausedAtStage ?? '')) {
    return 'scriptReview';
  }
  if (project.isPaused && ['STORYBOARD', 'REFERENCE_IMAGE'].includes(project.pausedAtStage ?? '')) {
    return 'visualReview';
  }

  if (ss.QA_REVIEW !== 'completed') return 'analysis';
  if (ss.KEYFRAME_GEN !== 'completed') return 'visualGenerating';
  return 'assembling';
}

export function getCardAction(_project: PipelineProject, status: DashboardStatus): { label: string; target: string } {
  if (status === 'scriptReview') return { label: '审核脚本', target: 'script' };
  if (status === 'visualReview' || status === 'visualGenerating') return { label: '审核视觉', target: 'storyboard' };
  if (status === 'completed') return { label: '查看成片', target: 'production' };
  if (status === 'error') return { label: '查看错误', target: 'production' };
  if (status === 'assembling') return { label: '查看进度', target: 'production' };
  return { label: '查看进度', target: 'style' };
}
