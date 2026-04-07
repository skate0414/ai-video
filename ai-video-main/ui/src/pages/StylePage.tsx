import { useState, useRef } from 'react';
import { Play, Square, Upload, ClipboardPaste, CheckCircle } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { api } from '../api/client';
import { ModelOverridePanel } from '../components/ModelOverridePanel';
import { SubStageProgress } from '../components/SubStageProgress';
import { ResourcePlannerPanel } from '../components/ResourcePlannerPanel';
import type { ModelOverrides } from '../types';

const STYLE_STAGES = ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION'] as const;

export function StylePage() {
  const { current, startPipeline, stopPipeline, updateModelOverrides, setStyleProfile } = useProject();
  const [videoFile, setVideoFile] = useState('');
  const [pastedAnalysis, setPastedAnalysis] = useState('');
  const [localOverrides, setLocalOverrides] = useState<ModelOverrides>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!current) return null;

  const isRunning = Object.values(current.stageStatus).some((s) => s === 'processing');
  const styleComplete = STYLE_STAGES.every((s) => current.stageStatus[s] === 'completed');

  const handleUploadAndStart = async () => {
    const files = fileInputRef.current?.files;
    let uploadedPath = videoFile;

    if (files?.length) {
      const file = files[0];
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const result = await api.uploadFiles([{ name: file.name, data: base64 }]);
      uploadedPath = result.paths[0];
    }

    if (Object.keys(localOverrides).length > 0) {
      await updateModelOverrides(current.id, localOverrides);
    }

    await startPipeline(current.id, uploadedPath || undefined);
  };

  const handleManualAnalysis = async () => {
    if (!pastedAnalysis.trim()) return;
    await setStyleProfile(current.id, { pastedText: pastedAnalysis, topic: current.topic });
    setPastedAnalysis('');
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100">🎨 风格初始化</h3>
      <SubStageProgress stages={[...STYLE_STAGES]} stageStatus={current.stageStatus} />

      <ResourcePlannerPanel projectId={current.id} />

      {!isRunning && !styleComplete && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-zinc-200">启动流水线</h4>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="参考视频路径 (可选)"
              value={videoFile}
              onChange={(e) => setVideoFile(e.target.value)}
              className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
            <label className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 cursor-pointer transition-colors">
              <Upload size={14} /> 选择文件
              <input type="file" ref={fileInputRef} accept="video/*" className="hidden" />
            </label>
            <button
              onClick={handleUploadAndStart}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <Play size={14} /> 启动流水线
            </button>
          </div>
          <ModelOverridePanel overrides={localOverrides} onChange={setLocalOverrides} />
        </div>
      )}

      {current.stageStatus.STYLE_EXTRACTION !== 'completed' && !isRunning && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <ClipboardPaste size={14} /> 手动分析 (粘贴 Gemini 分析结果)
          </h4>
          <p className="text-xs text-zinc-500">将参考视频上传到 Gemini 网页版，获取分析结果后粘贴到此处</p>
          <textarea
            rows={8}
            placeholder="粘贴 Gemini 返回的 JSON 或自由文本分析结果..."
            value={pastedAnalysis}
            onChange={(e) => setPastedAnalysis(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50 font-mono"
          />
          <button
            onClick={handleManualAnalysis}
            disabled={!pastedAnalysis.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            📥 设置风格档案并跳过分析
          </button>
        </div>
      )}

      {isRunning && (
        <button
          onClick={() => stopPipeline(current.id)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
        >
          <Square size={14} /> 停止
        </button>
      )}

      {styleComplete && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm font-medium">
          <CheckCircle size={16} /> 风格初始化已完成 — 可进入下一步
        </div>
      )}

      {(isRunning || styleComplete) && current.modelOverrides && Object.keys(current.modelOverrides).length > 0 && (
        <ModelOverridePanel overrides={current.modelOverrides} onChange={() => {}} disabled />
      )}
    </div>
  );
}
