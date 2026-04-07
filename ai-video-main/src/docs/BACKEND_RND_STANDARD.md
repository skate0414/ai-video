# 后端研发规范（阶段模板、命名、测试清单）

本文档用于统一 ai-video-main/src 后端的研发协作方式，减少返工与评审沟通成本。

## 1. 分层与依赖规范

允许的依赖方向：

- routes -> pipelineService / workbench
- pipelineService -> orchestrator + configStore
- orchestrator -> stageRegistry + infra + adapters
- stages -> adapters + prompts + types + safety utilities

禁止事项：

- routes 直接调用 orchestrator 内部实现细节
- stages 反向依赖 routes
- 在多个模块重复维护阶段顺序

## 2. 命名规范

### 2.1 文件命名

- 业务模块：camelCase.ts（如 qualityRouter.ts）
- 测试文件：同名 + .test.ts（如 runLock.test.ts）
- 文档文件：全大写或语义化下划线（如 BACKEND_RND_STANDARD.md）

### 2.2 类型与接口

- 接口：名词短语（如 StageDefinition、PipelineConfig）
- 函数：动词开头（如 runResearch、generateResourcePlan）
- 布尔函数：is/has/can 前缀（如 isAborted、hasApiKey）

### 2.3 阶段命名

- Stage 枚举值：全大写下划线（如 SCRIPT_GENERATION）
- 阶段实现函数：run + PascalCase（如 runScriptGeneration）

## 3. 新增阶段模板（标准流程）

## 3.1 实现文件模板

```ts
// src/pipeline/stages/myStage.ts
import type { AIAdapter } from '../types.js';

export interface MyStageOutput {
  ok: boolean;
  summary: string;
}

export async function runMyStage(adapter: AIAdapter, input: { topic: string }): Promise<MyStageOutput> {
  // 1) 参数与前置校验
  // 2) 调用 adapter
  // 3) 解析输出并做必要容错
  return { ok: true, summary: 'done' };
}
```

## 3.2 注册模板

```ts
// src/pipeline/stages/defs/creationStages.ts (示例)
import { registerStage } from '../../stageRegistry.js';
import { runMyStage } from '../myStage.js';

registerStage({
  stage: 'SCRIPT_GENERATION',
  execute: async (ctx) => {
    const adapter = ctx.getSessionAwareAdapter('SCRIPT_GENERATION', 'script_generation', ctx.project.modelOverrides);
    const result = await runMyStage(adapter, { topic: ctx.project.topic });
    ctx.saveArtifact('my-stage.json', result);
  },
});
```

## 3.3 上线前检查

- [ ] 已在 defs 中注册
- [ ] artifact 命名清晰且可追溯
- [ ] 失败时日志包含 stage、输入摘要、错误原因
- [ ] 重试语义明确（可重入、幂等）

## 4. 代码实现规范

### 4.1 错误处理

- 对外接口统一返回可读错误信息
- stage 内部错误应附带上下文，不要裸抛无信息异常
- 对外部依赖失败（网络/API/浏览器）必须分级处理：超时、重试、降级

### 4.2 日志规范

- 必须包含：projectId、stage、操作动作、结果
- 错误日志必须包含错误类型和关键信息摘要
- 避免记录敏感信息（api key、用户隐私原文）

### 4.3 并发与状态

- 同一 projectId 的 run 入口必须受 RunLock 保护
- 任何状态更新后要及时持久化
- 修改 stageStatus 时确保与 artifact 状态一致

## 5. 测试规范与清单

## 5.1 最低要求

任意功能改动至少满足：

- 1 个成功路径测试
- 1 个失败路径测试
- 1 个边界/异常输入测试

## 5.2 分层测试建议

- 路由层：参数校验、状态码、错误映射
- 服务层：方法契约与跨模块编排
- 编排层：阶段推进、暂停恢复、重试、并发互斥
- 阶段层：输入输出解析、artifact 读写、容错
- 适配层：外部依赖 mock + 降级行为

## 5.3 PR 测试检查清单

- [ ] npx tsc --noEmit 通过
- [ ] npx vitest run 通过
- [ ] 新增/修改代码有对应测试
- [ ] 回归风险点已覆盖

## 6. 评审规范（PR Checklist）

- [ ] 是否符合分层依赖方向
- [ ] 是否引入了隐式共享状态
- [ ] 是否影响并发安全与可恢复性
- [ ] 是否有清晰日志与可观测性
- [ ] 是否更新相关文档（README/本规范/接口说明）

## 7. 推荐提交流程

1. 小步提交，单一变更目标
2. 本地通过 tsc + vitest
3. 自查 checklist
4. 发起评审并附上影响范围说明
5. 合并后更新文档索引
