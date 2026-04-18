import { StageProviderSelector } from '../../components/StageProviderSelector';
import type { StageProviderOverrides } from '../../types';
import { Card } from '../../components/ui/Card';

export function ProviderSettings({ projectId, overrides, onChange }: {
  projectId?: string;
  overrides: StageProviderOverrides;
  onChange: (overrides: StageProviderOverrides) => void;
}) {
  return (
    <Card>
      <h3 className="text-xs font-bold text-zinc-400 mb-4 uppercase tracking-wider">
        AI 提供商配置（按步骤）
      </h3>
      <p className="text-[11px] text-zinc-500 mb-4">
        为每个流水线步骤选择 AI 提供商。未配置的步骤将使用质量等级的默认路由。
      </p>
      <StageProviderSelector
        projectId={projectId}
        overrides={overrides}
        onChange={onChange}
      />
    </Card>
  );
}
