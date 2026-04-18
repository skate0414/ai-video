import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const BASE_STAGES = [
  { path: 'style', label: '风格' },
  { path: 'script', label: '脚本' },
  { path: 'storyboard', label: '分镜' },
  { path: 'production', label: '制作' },
] as const;

const DEV_ONLY_STAGES = [
  { path: 'replay', label: '回放' },
] as const;

export function StageBreadcrumb() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  if (!projectId) return null;

  const stages = import.meta.env.DEV
    ? [...BASE_STAGES, ...DEV_ONLY_STAGES]
    : BASE_STAGES;

  const currentPath = location.pathname.replace(/.*\//, '');
  const currentIdx = stages.findIndex(s => s.path === currentPath);
  if (currentIdx < 0) return null;

  return (
    <nav className="flex items-center gap-1 text-[11px]" aria-label="Stage breadcrumb">
      {stages.slice(0, currentIdx + 1).map((stage, i) => {
        const isCurrent = i === currentIdx;
        return (
          <span key={stage.path} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-zinc-700" />}
            <button
              onClick={() => !isCurrent && navigate(`/${projectId}/${stage.path}`)}
              disabled={isCurrent}
              className={
                isCurrent
                  ? 'text-zinc-300 font-medium cursor-default'
                  : 'text-zinc-600 hover:text-zinc-300 transition-colors'
              }
            >
              {stage.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
