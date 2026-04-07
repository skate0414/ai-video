# 后端 Onboarding：10 分钟上手

目标：帮助新同学在 10 分钟内跑起来、看懂主链路、找到可开始改动的位置。

## 0-2 分钟：先建立全局认知

你要记住三层主线：

1. HTTP 接入：server.ts + routes/*
2. Pipeline 门面：pipeline/pipelineService.ts
3. 执行编排：pipeline/orchestrator.ts + pipeline/stages/*

一句话：路由只调服务，服务再调编排，阶段实现由注册中心组织。

## 2-4 分钟：看入口和路由

按顺序阅读：

1. server.ts
2. routes/pipeline.ts
3. routes/setup.ts
4. routes/workbench.ts

重点看：

- Route 是如何拼接成总路由表的
- 请求如何被转到 PipelineService
- SSE 事件是如何广播的

## 4-6 分钟：看 pipeline 主流程

按顺序阅读：

1. pipeline/pipelineService.ts
2. pipeline/orchestrator.ts
3. pipeline/stageRegistry.ts

重点看：

- start/retry/resume 的入口方法
- run() 如何通过 getStageDefinitions() 执行阶段
- StageRunContext 给阶段暴露了哪些能力（adapter、artifact、事件等）

## 6-8 分钟：看阶段与适配层

按顺序阅读：

1. pipeline/stages/defs/index.ts
2. pipeline/stages/defs/*.ts
3. pipeline/stages/*.ts
4. adapters/*.ts

重点看：

- 一个阶段是如何注册并被 orchestrator 调用的
- 阶段如何读取/写入 artifact
- Adapter 如何统一实现 AIAdapter 接口

## 8-10 分钟：本地验证与首个改动

建议先做一次最小改动并验证：

1. 在某个 stage 的日志中增加一条标识信息
2. 运行类型检查与测试
3. 确认没有破坏主流程

常用命令：

```bash
npx tsc --noEmit
npx vitest run
```

## 新同学第一周建议任务

- 任务 A：给一个 stage 补齐失败分支日志
- 任务 B：给一个 route 增加参数校验
- 任务 C：为 pipelineService 新增一个只读查询方法 + 测试

## 关键协作约定（必须遵守）

- 不要在 routes 层写业务流程。
- 新阶段必须走 stageRegistry 注册，不要在 orchestrator 硬插。
- 涉及项目数据写入时优先通过 ProjectStore。
- 涉及并发入口时确认 RunLock 语义。
- 修改接口或行为时同步更新文档与测试。

## 快速排障路径

出现问题时按这个顺序定位：

1. server.ts 日志（请求是否进入）
2. route 层参数与错误映射
3. pipelineService 方法是否被调用
4. orchestrator 阶段状态推进
5. 对应 stage artifact 是否读写成功
6. adapter 外部调用是否超时/限流/结构变化

## 你最先应该熟悉的文件

- server.ts
- routes/pipeline.ts
- pipeline/pipelineService.ts
- pipeline/orchestrator.ts
- pipeline/stageRegistry.ts
- pipeline/projectStore.ts
- pipeline/runLock.ts
- pipeline/stages/defs/index.ts
