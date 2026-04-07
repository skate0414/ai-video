import { Download } from 'lucide-react';
import { api } from '../api/client';
import type { PipelineProject } from '../types';

export function VideoPlayer({ project }: { project: PipelineProject }) {
  if (!project.finalVideoPath || project.stageStatus.ASSEMBLY !== 'completed') {
    return null;
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-zinc-200">🎬 最终视频</h4>
      <video
        className="w-full rounded-lg border border-zinc-800 bg-black"
        controls
        src={api.getVideoUrl(project.id)}
      />
      <a
        href={api.getVideoUrl(project.id)}
        download={`${project.title}.mp4`}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
      >
        <Download size={14} /> 下载视频
      </a>
    </div>
  );
}
