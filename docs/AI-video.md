把这个项目想象成一个**无人电影制片厂**：

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   🏭 制片厂大楼（Electron 浏览器壳）                            │
│   ─────────────────────────────────                         │
│   一栋可以开任意数量房间的办公楼。                               │
│   现在用来拍视频，但这栋楼本身可以                               │
│   改成做任何事——翻译公司、设计工作室、                            │
│   数据分析所。楼不关心里面干什么。                               │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │                                                   │     │
│   │  🤖 外派员工团队（Adapters + ResourceManager）       │     │
│   │  ──────────────────────────────────               │     │
│   │  一群会操作电脑的机器人。每天被派到                    │     │
│   │  不同的 AI 公司"上班"：                             │     │
│   │                                                 │     │
│   │  机器人 A → 去 Gemini 办公室做视频分析              │     │
│   │  机器人 B → 去 ChatGPT 办公室画图                   │     │
│   │  机器人 C → 去 Claude 办公室写脚本                  │     │
│   │  机器人 D → 去 aivideomaker 办公室做视频            │     │
│   │                                                  │     │
│   │  它们坐在别人的电脑前，用别人的工具干活，               │     │
│   │  干完把结果带回来。如果一家公司说"今天                 │     │
│   │  免费额度用完了"，它们自动换到下一家。                 │     │
│   │                                                  │     │
│   │  （这就是 Playwright 聊天自动化 +                   │     │
│   │    FallbackAdapter + 配额轮换的本质）               │     │
│   │                                                   │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │                                                   │     │
│   │  📋 导演（Pipeline Orchestrator）                  │     │
│   │  ──────────────────────────                        │     │
│   │  只有一个人。它拿着一张 15 步拍摄计划表，             │     │
│   │  按顺序喊：                                        │     │
│   │                                                   │     │
│   │  "第 1 步，安全检查！"                              │     │
│   │  "第 2 步，分析参考视频风格！派机器人 A 去！"        │     │
│   │  "第 5 步，写脚本！派机器人 C 去！"                 │     │
│   │  "第 7 步，暂停！让老板过目脚本！"                   │     │
│   │      ⏸️ ← 你在这里审核                             │     │
│   │  "老板说 OK，继续！第 8 步，画分镜！"               │     │
│   │  ...                                              │     │
│   │  "第 14 步，拼片子！叫本地师傅！"                   │     │
│   │  "第 15 步，验收！"                                │     │
│   │                                                   │     │
│   │  导演不做任何创作——它只管谁先谁后、                  │     │
│   │  出了问题找谁、什么时候暂停请示老板。                │     │
│   │                                                   │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │                                                   │     │
│   │  📜 剧本和工作手册（Prompts + CIR 类型系统）       │     │
│   │  ──────────────────────────────────                │     │
│   │  17 份详细的工作指令（prompt 模板），                │     │
│   │  告诉每个机器人到了 AI 办公室该说什么。              │     │
│   │                                                   │     │
│   │  以及一套标准化的"交接单格式"（CIR），               │     │
│   │  确保机器人 A 带回来的分析报告，                     │     │
│   │  机器人 C 能直接读懂拿去写脚本。                    │     │
│   │                                                   │     │
│   │  没有这套格式，每个机器人带回来的东西                │     │
│   │  格式都不一样，下一个机器人看不懂。                  │     │
│   │                                                   │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │                                                   │     │
│   │  🔧 本地车间（FFmpeg + edge-tts）                  │     │
│   │  ──────────────────────────                        │     │
│   │  不用出门、不用 AI、不花钱。                        │     │
│   │  就在楼里的地下室：                                 │     │
│   │                                                   │     │
│   │  - 配音间（edge-tts）：把文字念成语音               │     │
│   │  - 剪辑室（FFmpeg）：把图片、视频、语音、           │     │
│   │    字幕、背景音乐拼成一个完整 MP4                   │     │
│   │                                                   │     │
│   │  这是整条线上唯一 100% 确定性的环节——               │     │
│   │  输入什么就出什么，不存在"AI 发挥不好"。            │     │
│   │                                                   │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │                                                   │     │
│   │  🖥️ 老板的监控室（React UI）                      │     │
│   │  ──────────────────                                │     │
│   │  你坐在这里。你能看到：                             │     │
│   │  - 每个项目进行到哪一步了                           │     │
│   │  - 脚本写出来了，你读一遍，批准或打回               │     │
│   │  - 图片生成了，你看一眼，通过或重做                  │     │
│   │  - 最终片子出来了，下载                             │     │
│   │                                                   │     │
│   │  你不需要知道机器人去了哪家公司、                    │     │
│   │  用了谁的免费额度、FFmpeg 跑了什么命令。            │     │
│   │  你只管"这个脚本行不行""这张图好不好"。             │     │
│   │                                                   │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 五个模块一句话

| 模块 | 比喻 | 本质 |
|------|------|------|
| **Electron 浏览器壳** | 制片厂大楼 | 通用基础设施，可承载任何任务 |
| **Adapters + ResourceManager** | 外派机器人团队 | 自动操作各家 AI 服务，免费优先，配额轮换 |
| **Pipeline Orchestrator** | 导演 | 15 步流程编排，暂停/恢复/错误处理 |
| **Prompts + CIR** | 剧本 + 标准交接单 | 创意指令 + 模块间数据格式 |
| **FFmpeg + edge-tts** | 地下室车间 | 本地确定性生产，不依赖网络 |
| **React UI** | 老板监控室 | 你审核和决策的地方 |

**这个项目最独特的地方**不是"用 AI 做视频"——很多产品都能做。它独特的地方是**那群会上网的机器人**：通过浏览器自动化，用各家 AI 的免费层完成全部工作，不需要付费 API key（除非免费额度用完了才 fallback 到付费）。这个机器人团队 + 大楼的组合，理论上可以搬去做任何需要"自动操作多个 AI 网站"的事情。  


---

# 任务：架构重构 — 提取通用引擎 + 域封装

## 目标

将项目从"视频生成工具"重构为"通用多阶段 AI 自动化引擎 + 视频生成域"。完成后目录结构变为：

```
phantom-stage/
├── core/              # 通用引擎（与视频业务无关）
├── domains/
│   └── video/         # 视频生成域（所有视频专用代码）
├── ui/                # 前端（不变）
├── browser-shell/     # Electron 壳（不变）
├── shared/            # 共享类型（不变）
├── data/              # 运行时数据（不变）
└── scripts/           # 构建脚本（不变）
```

## 重要原则

1. **每移动一批文件后，立刻运行 `npx tsc --noEmit` 修复所有 import 路径，确保编译通过，再移下一批**
2. **不改任何业务逻辑，只移动文件和修复 import**
3. **最终 `npx vitest run` 全部测试通过**
4. 如果某个文件分类有疑问（通用 vs 视频专用），先标记不动，最后统一处理

## 准备工作

### 0A. 创建目标目录结构

```bash
mkdir -p core/browser
mkdir -p core/agents
mkdir -p core/pipeline
mkdir -p core/resources
mkdir -p core/server
mkdir -p core/store
mkdir -p core/lib
mkdir -p domains/video/stages/defs
mkdir -p domains/video/prompts
mkdir -p domains/video/cir
mkdir -p domains/video/adapters
mkdir -p domains/video/routes
```

### 0B. 建立移动清单

在动手之前，先读取以下文件，确认每个文件的 import/export 依赖关系：

```bash
# 列出 src/ 下所有 .ts 文件
find src/ -name '*.ts' | sort
```

对每个文件，标记为 `CORE`（通用）或 `DOMAIN`（视频专用）或 `UNCLEAR`（不确定）。用以下判断标准：

| 标准 | 分类 |
|------|------|
| 不包含任何视频/脚本/分镜/TTS/FFmpeg 相关逻辑 | CORE |
| 功能可被任何多阶段 AI 任务复用 | CORE |
| 包含视频阶段名（STYLE_EXTRACTION, SCRIPT_GENERATION 等）| DOMAIN |
| 包含视频专用 prompt 模板 | DOMAIN |
| 包含视频 CIR 类型 | DOMAIN |
| 包含 FFmpeg/TTS/视频生成/图片生成的具体实现 | DOMAIN |

将分类结果输出为表格，确认后再移动。

---

## 第一阶段：提取 core/

### 批次 1：core/lib（最底层，无外部依赖）

```
移动：
src/lib/*  →  core/lib/
```

移动后：
1. `npx tsc --noEmit` — 修复所有引用 `src/lib/` 的 import
2. 搜索 `from.*['\"].*src/lib` 或相对路径引用 `../lib`，全部更新为指向 `core/lib/`

### 批次 2：core/store

```
移动：
src/configStore.ts  →  core/store/configStore.ts
```

注意：configStore 可能引用 lib，确认 import 路径正确。

### 批次 3：core/resources

```
移动：
src/resourceManager.ts  →  core/resources/resourceManager.ts
src/taskQueue.ts        →  core/resources/taskQueue.ts
src/rateLimiter.ts      →  core/resources/rateLimiter.ts
```

### 批次 4：core/browser

```
移动：
src/browserManager.ts   →  core/browser/manager.ts
src/workbench.ts        →  core/browser/workbench.ts
src/electronBridge.ts   →  core/browser/electronBridge.ts
```

### 批次 5：core/agents

```
移动：
src/adapters/chatAdapter.ts      →  core/agents/chatAgent.ts
src/adapters/geminiAdapter.ts    →  core/agents/apiAgent.ts
src/adapters/fallbackAdapter.ts  →  core/agents/fallbackStrategy.ts
src/adapters/responseParser.ts   →  core/agents/responseParser.ts
src/adapters/schemaValidator.ts  →  core/agents/schemaValidator.ts
```

**重命名说明**：
- `chatAdapter` → `chatAgent`：它不只是适配器，它是一个能操作浏览器的 agent
- `geminiAdapter` → `apiAgent`：通用 API 调用 agent
- `fallbackAdapter` → `fallbackStrategy`：它是策略，不是适配器

**注意**：如果这些文件内部引用了视频专用常量（如视频阶段名），只移动文件，不改内部逻辑。但在文件顶部加注释标记 `// TODO: 移除视频专用引用` 供后续清理。

### 批次 6：core/pipeline

```
移动：
src/pipeline/orchestrator.ts     →  core/pipeline/orchestrator.ts
src/pipeline/sessionManager.ts   →  core/pipeline/sessionManager.ts
src/pipeline/qualityRouter.ts    →  core/pipeline/qualityRouter.ts
src/pipeline/providerRegistry.ts →  core/pipeline/providerRegistry.ts
src/pipeline/types.ts            →  core/pipeline/types.ts
```

**关键判断**：orchestrator.ts 内部可能硬编码了视频阶段名或视频专用逻辑。处理方式：

- 如果硬编码的量少（< 10 处）→ 移动文件，内部加 `// TODO: 从 DomainDefinition 动态读取` 注释
- 如果硬编码的量大 → 移动文件，但在报告中标记"需要后续泛化"

### 批次 7：core/server

```
移动：
src/server.ts    →  core/server/server.ts
src/providers.ts →  core/server/providers.ts（如果是通用的提供商定义）
src/types.ts     →  core/server/types.ts（如果是后端补充类型，检查内容是否通用）
```

**注意**：`src/server.ts` 可能注册了视频专用路由。如果是：
- 将路由注册部分提取为一个函数调用（`registerVideoRoutes(app)`）
- server.ts 本体移入 core/，视频路由注册留在 domain 中

### 每批次完成后的检查点

```bash
npx tsc --noEmit 2>&1 | head -30
# 如果有错误，全部修复后再继续下一批
```

---

## 第二阶段：封装 domains/video/

### 批次 8：domains/video/stages

```
移动：
src/pipeline/stages/defs/analysisStages.ts    →  domains/video/stages/defs/analysisStages.ts
src/pipeline/stages/defs/creationStages.ts    →  domains/video/stages/defs/creationStages.ts
src/pipeline/stages/defs/visualStages.ts      →  domains/video/stages/defs/visualStages.ts
src/pipeline/stages/defs/productionStages.ts  →  domains/video/stages/defs/productionStages.ts
src/pipeline/stages/scriptGeneration.ts       →  domains/video/stages/scriptGeneration.ts
src/pipeline/stages/qaReview.ts               →  domains/video/stages/qaReview.ts
src/pipeline/stages/contamination.ts          →  domains/video/stages/contamination.ts
src/pipeline/stages/sourceMarkerCheck.ts      →  domains/video/stages/sourceMarkerCheck.ts
src/pipeline/stages/scriptValidator.ts        →  domains/video/stages/scriptValidator.ts
```

以及 `src/pipeline/stages/` 下其他所有阶段实现文件。

### 批次 9：domains/video/prompts

```
移动：
src/pipeline/prompts.ts  →  domains/video/prompts/prompts.ts
```

### 批次 10：domains/video/cir

```
移动：
src/cir/types.ts      →  domains/video/cir/types.ts
src/cir/loader.ts     →  domains/video/cir/loader.ts
src/cir/parsers.ts    →  domains/video/cir/parsers.ts
```

### 批次 11：domains/video/adapters

```
移动：
src/adapters/videoProvider.ts     →  domains/video/adapters/videoProvider.ts
src/adapters/ttsProvider.ts       →  domains/video/adapters/ttsProvider.ts
src/adapters/ffmpegAssembler.ts   →  domains/video/adapters/ffmpegAssembler.ts
src/adapters/imageExtractor.ts    →  domains/video/adapters/imageExtractor.ts
```

### 批次 12：domains/video/routes

```
移动：
src/routes/pipeline.ts  →  domains/video/routes/pipeline.ts
```

`src/routes/` 下其他路由文件逐个检查：
- 视频专用路由 → 移到 `domains/video/routes/`
- 通用路由（如项目 CRUD、设置、SSE） → 移到 `core/server/routes/`

### 批次 13：域注册入口

新建 `domains/video/domain.ts`：

```typescript
// domains/video/domain.ts

import { analysisStages } from './stages/defs/analysisStages';
import { creationStages } from './stages/defs/creationStages';
import { visualStages } from './stages/defs/visualStages';
import { productionStages } from './stages/defs/productionStages';
// ... 其他 import

import type { DomainDefinition } from '../../core/pipeline/types';

export const videoDomain: DomainDefinition = {
  name: 'video',
  
  stages: [
    ...analysisStages,
    ...creationStages,
    ...visualStages,
    ...productionStages,
  ],
  
  pauseAfterStages: ['QA_REVIEW', 'REFERENCE_IMAGE'],
  
  sessionGroups: {
    Analysis: ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH'],
    Creation: ['NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING'],
    Visual: ['STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'],
    Production: ['VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'],
  },
};
```

**注意**：`DomainDefinition` 接口如果在 `core/pipeline/types.ts` 中还不存在，新建它。但**保持最简**——只包含当前 videoDomain 实际需要导出的字段。不要提前设计"未来可能需要"的字段。

### 批次 14：清理 src/

移动完成后，`src/` 应该是空的或只剩几个未归类的文件。

```bash
find src/ -name '*.ts' | sort
```

- 如果为空 → 删除 `src/` 目录
- 如果有残留 → 逐个判断归属，移到 core/ 或 domains/video/

---

## 第三阶段：更新构建配置

### 批次 15：tsconfig 更新

更新根目录 `tsconfig.json`（或多个 tsconfig）的 `include` 和 `paths`：

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["core/*"],
      "@domains/*": ["domains/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["core/**/*", "domains/**/*", "shared/**/*"]
}
```

**注意**：
- 检查是否有多个 tsconfig（前端、后端、测试各一个），每个都要更新
- 如果项目不使用 path aliases，不需要加 `paths`——直接用相对路径即可
- 优先保持当前的 import 风格（如果当前用相对路径，继续用相对路径）

### 批次 16：package.json 更新

检查 `package.json` 中的 `main`、`scripts` 中的路径引用：

```bash
grep -n 'src/' package.json
grep -n 'src/' scripts/*.sh scripts/*.ts 2>/dev/null
```

所有 `src/server.ts` → `core/server/server.ts` 等路径引用要更新。

### 批次 17：测试文件迁移

```bash
find . -name '*.test.ts' -o -name '*.spec.ts' | grep -v node_modules | sort
```

测试文件跟随被测文件移动：
- `src/pipeline/stages/contamination.test.ts` → `domains/video/stages/contamination.test.ts`
- `src/pipeline/stages/sourceMarkerCheck.test.ts` → `domains/video/stages/sourceMarkerCheck.test.ts`
- 通用模块的测试 → `core/` 对应目录下

更新 vitest 配置的测试文件匹配模式（如果有的话）。

---

## 第四阶段：常量和共享类型处理

### 批次 18：constants.ts 拆分

`src/constants.ts` 可能混合了通用常量和视频专用常量：

1. 读取 `src/constants.ts` 完整内容
2. 通用常量（如 HTTP 状态码、通用配置键）→ `core/constants.ts`
3. 视频专用常量（如 ARTIFACT 名称、阶段名枚举）→ `domains/video/constants.ts`
4. 如果拆分后只需要一处，不拆

### 批次 19：shared/types.ts 检查

`shared/types.ts` 可能包含视频专用类型（如 `Scene`、`StyleProfile`）和通用类型（如 `PipelineProject`、`AIAdapter`）。

**暂时不拆分 shared/types.ts**。原因：前端同时需要通用类型和视频类型，拆分后 import 变复杂但收益不大。在文件内用注释分区即可：

```typescript
// ===== CORE TYPES =====
// PipelineProject, PipelineStage, AIAdapter, etc.

// ===== VIDEO DOMAIN TYPES =====
// Scene, StyleProfile, ScriptCIR, etc.
```

---

## 验证清单

全部完成后，依次验证：

```bash
# 1. 确认 src/ 已清空或删除
find src/ -name '*.ts' 2>/dev/null | wc -l  # 应该是 0

# 2. TypeScript 编译
npx tsc --noEmit

# 3. 全量测试
npx vitest run

# 4. 服务启动冒烟测试
npm start &
sleep 5
curl -s http://localhost:PORT/api/projects | head -5

# 5. 确认无残留引用
grep -rn 'from.*["\x27].*src/' core/ domains/ ui/src/ shared/ --include='*.ts' --include='*.tsx' | grep -v node_modules
# 应该是 0 结果
```

---

## 输出报告

```
## 重构报告

### 文件移动清单
| 原路径 | 新路径 | 分类 |
|--------|--------|------|
| src/lib/logger.ts | core/lib/logger.ts | CORE |
| src/pipeline/stages/qaReview.ts | domains/video/stages/qaReview.ts | DOMAIN |
| ... | ... | ... |

### 分类决策（UNCLEAR 的文件）
| 文件 | 最终归属 | 判断理由 |
|------|---------|---------|
| ... | ... | ... |

### 遗留 TODO
| 文件 | TODO 内容 | 优先级 |
|------|----------|--------|
| core/pipeline/orchestrator.ts | 移除硬编码的视频阶段名 | 低（等第二个域时再做） |
| ... | ... | ... |

### 验证结果
- tsc: clean / N errors
- vitest: N passed / N failed
- 服务启动: OK / 失败原因
- 残留引用: 0 / N 处
```

## 规则

- **不改任何业务逻辑**——只移动文件、改 import 路径、加 TODO 注释
- **每批次后编译检查**——不要一口气移完再修 import，那样错误会爆炸
- 如果某个文件同时包含通用代码和视频代码，**不要拆分文件**——整个文件归属于依赖更强的一方，加 TODO 标记
- 重命名文件时（如 chatAdapter → chatAgent），**同时更新所有 import**，搜索旧名确认无残留
- `browser-shell/`、`ui/`、`data/`、`scripts/` **不动**（ui/ 的域化留到后续）

---

执行完发结果给我。如果中间某个批次遇到大量循环依赖或编译错误难以解决，停下来告诉我具体情况，我来判断是否需要调整移动策略。    

