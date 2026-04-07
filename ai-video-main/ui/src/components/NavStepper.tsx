import { NavLink } from 'react-router-dom';
import { Check, Lock } from 'lucide-react';
import type { PipelineStage, ProcessStatus } from '../types';

interface WizardStep {
  key: string;
  label: string;
  path: string;
  icon: string;
  unlockAfter: PipelineStage[];
}

const STEPS: WizardStep[] = [
  { key: 'style', label: '风格初始化', path: 'style', icon: '🎨', unlockAfter: [] },
  { key: 'script', label: '脚本创作', path: 'script', icon: '✍️', unlockAfter: ['STYLE_EXTRACTION'] },
  { key: 'storyboard', label: '视觉设计', path: 'storyboard', icon: '🎬', unlockAfter: ['QA_REVIEW'] },
  { key: 'production', label: '制作交付', path: 'production', icon: '📦', unlockAfter: ['KEYFRAME_GEN'] },
];

function isUnlocked(step: WizardStep, stageStatus: Record<PipelineStage, ProcessStatus>): boolean {
  return step.unlockAfter.every((s) => stageStatus[s] === 'completed');
}

const PAGE_STAGES: Record<string, PipelineStage[]> = {
  style: ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION'],
  script: ['RESEARCH', 'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW'],
  storyboard: ['STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'],
  production: ['VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'],
};

function getStepStatus(step: WizardStep, stageStatus: Record<PipelineStage, ProcessStatus>): 'completed' | 'processing' | 'pending' {
  const stages = PAGE_STAGES[step.key];
  if (stages.every((s) => stageStatus[s] === 'completed')) return 'completed';
  if (stages.some((s) => stageStatus[s] === 'processing')) return 'processing';
  return 'pending';
}

export function NavStepper({ stageStatus }: { stageStatus: Record<PipelineStage, ProcessStatus> }) {
  return (
    <nav className="flex items-center justify-center w-full max-w-2xl mx-auto py-4 px-6">
      {STEPS.map((step, i) => {
        const unlocked = isUnlocked(step, stageStatus);
        const status = getStepStatus(step, stageStatus);
        const isCompleted = status === 'completed';
        const isProcessing = status === 'processing';

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            {unlocked ? (
              <NavLink
                to={step.path}
                className={({ isActive }) => `
                  flex flex-col items-center gap-1.5 group relative cursor-pointer
                  ${isActive ? 'scale-105' : ''}
                `}
              >
                {({ isActive }) => (
                  <>
                    <div className={`
                      w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 text-sm
                      ${isCompleted
                        ? 'bg-emerald-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                        : isActive
                          ? 'bg-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)] ring-2 ring-indigo-500/20'
                          : isProcessing
                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 animate-pulse'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }
                    `}>
                      {isCompleted ? <Check size={16} /> : step.icon}
                    </div>
                    <span className={`
                      text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors
                      ${isCompleted ? 'text-emerald-500' : isActive ? 'text-indigo-400' : 'text-zinc-600'}
                    `}>
                      {step.label}
                    </span>
                  </>
                )}
              </NavLink>
            ) : (
              <div className="flex flex-col items-center gap-1.5 opacity-40 cursor-not-allowed">
                <div className="w-9 h-9 rounded-full bg-zinc-900 text-zinc-600 border border-zinc-800 flex items-center justify-center">
                  <Lock size={14} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 whitespace-nowrap">
                  {step.label}
                </span>
              </div>
            )}

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div className={`
                flex-grow h-[2px] mx-3 rounded-full transition-colors duration-500
                ${isCompleted ? 'bg-emerald-500' : 'bg-zinc-800'}
              `} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
