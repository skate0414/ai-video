# DOM 探测系统技术设计文档（变更评审稿）

> 文档版本：2026-04-11
> 适用范围：网页 DOM 自动化探测链路（Chat / Video / Image 三条路径）
> 文档性质：技术设计 + 变更评审 + 实施总结

---

## 1. 背景与目标

### 1.1 背景

本项目依赖 Playwright 浏览器自动化操控 AI 网站，以执行文本生成、图片生成、视频生成等任务，从而降低对付费 API 的依赖成本。由于目标网站的 DOM 结构频繁变化，且存在 A/B 测试、页面改版、国际化、多语言渲染、Shadow DOM、SPA 重渲染等情况，固定硬编码选择器的方式已经无法满足长期稳定运行要求。

DOM 探测系统的职责，就是在运行时识别页面上的关键交互元素，并将探测结果持久化、健康监控、按需重探测，使自动化链路具备自适应能力。

### 1.2 目标

本次设计的目标是将 DOM 探测系统从"单点探测"升级为"可持续维护的选择器基础设施"，实现以下能力：

1. 自动适应页面改版，减少人工修复成本。
2. 支持多策略选择器链，降低单一 selector 失效风险。
3. 支持结果持久化与启动恢复，避免每次重启重新探测。
4. 支持健康监控与自动重探测，形成闭环自愈能力。
5. 对 Chat / Video / Image 三条路径提供一致的探测与桥接机制。
6. 防止低质量自动探测结果污染内置预设，尤其是 responseBlock。

---

## 2. 系统定位

### 2.1 在整体架构中的位置

```
前端 UI ──→ HTTP/SSE ──→ 后端路由 ──→ 流水线编排器 (15步)
                                          │
                                    质量路由器
                                    ├─ 付费 API 路径 (GeminiAdapter)    ← 不需要 DOM 探测
                                    └─ 免费聊天路径 (ChatAdapter)       ← 依赖 DOM 探测
                                         │
                                    ┌────┴────────────────────────┐
                                    │     DOM 探测系统             │  ← 在这里
                                    │  (选择器解析 + 探测 + 缓存)  │
                                    └────┬────────────────────────┘
                                         │
                                    Playwright 浏览器操作
                                    (点击、输入、等待、截图)
```

DOM 探测系统位于浏览器自动化层，是自动化执行的"眼睛"。它负责定位：

* 输入框（promptInput）
* 发送按钮（sendButton）
* 响应区域（responseBlock）
* 上传入口（fileUploadTrigger / imageUploadTrigger）
* 进度区域（progressIndicator）
* 下载入口（downloadButton）
* 视频生成相关控件（generateButton / videoResult）

其上游是路由与流水线编排器，下游是 Playwright 的具体点击、输入、等待与截图动作。

### 2.2 核心价值

DOM 探测系统的核心价值不在于"能不能找到一个元素"，而在于：

* 是否能长期稳定地找到正确元素；
* 是否能在页面变动后自动恢复；
* 是否能避免错误 selector 被缓存并持续放大故障；
* 是否能为不同资源类型提供统一机制。

### 2.3 影响面

DOM 探测系统直接影响 15 步流水线中依赖浏览器自动化的阶段：

| 流水线阶段 | 依赖的自动化路径 | DOM 探测覆盖 |
|---|---|---|
| ⑤ 脚本生成、⑥ QA 审查 等文本阶段 | ChatAdapter (Chat 路径) | ✅ 5/8 字段自动探测 |
| ⑩ 参考图、⑪ 关键帧 (图片生成) | ChatAdapter + ImageExtractor (Image 路径) | ✅ responseBlock 已接入 |
| ⑫ 视频生成 | VideoProvider (Video 路径) | ✅ 6/6 字段自动探测 |

简言之，**没有 DOM 探测系统，免费自动化路径就会因为网站改版而频繁失效**，这直接威胁到项目"低成本 AI 视频生产"的核心目标。

---

## 3. 范围说明

### 3.1 覆盖范围

本设计覆盖以下三条路径：

| 路径 | 入口 | 探测字段数 | 覆盖率 |
|------|------|-----------|--------|
| **Chat 路径** | `autoDetectSelectors()` | 5/8 (62.5%) | 文本输入、发送、等待响应、附件上传、就绪指示 |
| **Video 路径** | `autoDetectVideoSelectors()` | 6/6 (100%) | 视频生成、图片上传、进度监控、下载等 |
| **Image 路径** | `extractLatestImage()` + SelectorChain | 1/3 (33%) | 响应块识别（调用方传入 SelectorChain） |

> **覆盖率口径说明**：上述覆盖率均以"该路径内可自动探测的字段数 / 该路径总字段数"为基准。跨路径汇总覆盖率为 11/14 (78.6%)。

### 3.2 故意不做 / 架构边界

以下内容经评估后决定**保持现状**，不纳入自动探测：

| 字段 | 路径 | 不做原因 |
|------|------|---------|
| `modelPickerTrigger` | Chat | 需用户交互后才可见，无法在页面加载时探测 |
| `modelOptionSelector` | Chat | 依赖 modelPicker 打开，探测时机不确定 |
| `quotaExhaustedIndicator` | Chat | 仅在触发配额限制时出现，探测 = 误判 |
| `modelSelection` / `durationSelection` / `resolutionSelection` | Video | `selectVideoOptions()` 的文本搜索方式弹性更高 |
| `paywallDetection` / `loginDetection` | Video | 文本/URL 特征稳定，无需选择器化 |
| `imageFinding` / `imageDownload` | Image | 纯 DOM 计算（面积排序），不依赖选择器 |

### 3.3 不在本次范围内

以下内容已评估为**收益有限或风险较高**，暂不实施：

* `ProviderSelectors` 公共字段类型统一为 `SelectorChain`（影响 15+ 处，风险高）
* `selectVideoOptions()` 全面 SelectorChain 化（文本搜索更具弹性）

---

## 4. 现有架构说明

### 4.1 选择器解析链

系统实现了一条 **五层降级** 的选择器解析链：

```
┌──────────────────────────────────────────────────────────┐
│ 1. 运行时自动探测                                         │
│    ↳ autoDetectSelectors()（Chat，5 个元素）               │
│    ↳ autoDetectVideoSelectors()（Video，6 个元素）         │
│    ↳ Shadow DOM 穿透 (querySelectorAllDeep)               │
│    ↳ 结果持久化到 selector-cache.json                     │
│    ↳ ⚠️ 内置 provider 的 responseBlock 不被探测覆盖       │
├──────────────────────────────────────────────────────────┤
│ 2. 定期健康监控                                           │
│    ↳ probeSelectors() 策略级粒度探测                      │
│    ↳ lastWorked/failCount 持久化追踪                      │
│    ↳ 低于阈值自动重探测（按资源类型分发）                   │
├──────────────────────────────────────────────────────────┤
│ 3. 用户自定义覆盖                                         │
│    ↳ setProviderSelectors() / UI 调试器                   │
│    ↳ 持久化到 data/providers.json                        │
├──────────────────────────────────────────────────────────┤
│ 4. 预设模板 (PROVIDER_PRESETS / SelectorChain)            │
│    ↳ providerPresets.ts 中定义（多策略 + 优先级 + 多语言） │
├──────────────────────────────────────────────────────────┤
│ 5. 硬编码默认值 (DEFAULT_PROVIDERS — @deprecated)         │
│    ↳ 单字符串 CSS 选择器，仅作最终降级                    │
└──────────────────────────────────────────────────────────┘
```

**解析入口**：`workbench.getSelectors(provider)` → 优先 PROVIDER_PRESETS → customProviders → 合并 selectorOverrides。

### 4.2 关键原则

#### 原则一：预设优先（responseBlock）

对于内置 provider，`responseBlock` 不允许被自动探测结果覆盖。

**原因**：自动探测只能验证 `querySelectorAll(sel).length > 0`，无法判断该元素是否真的是回复正文，容易误命中品牌图标、侧边栏、装饰性元素等（如 Gemini 上的 `[class*="assistant"]` 匹配了非响应区域）。

**优先级**：预设多策略 SelectorChain > 缓存恢复 > 自动探测。自动探测结果不写入内置 provider 的 responseBlock。

**执行点**：
* `applyDetectedSelectors()`（运行时探测后）
* `loadSelectorCache()`（启动加载缓存时）

#### 原则二：响应计数容错

在发送 prompt 后，某些 SPA 页面会发生重渲染，导致响应元素计数短暂回退（`currentCount < beforeCount`）。系统必须重置基线（`adjustedBeforeCount = currentCount`）继续等待响应，而不能直接判定超时失败。

#### 原则三：探测失败不阻塞

所有自动探测失败必须降级到硬编码/预设值，不抛异常。探测在后台异步进行（`(async () => { ... })()`），不阻塞主流程。

#### 原则四：幂等性

多次探测应合并结果而非整体覆盖。实现方式：`{ ...existing, ...detected }`，仅已探测到的字段（非 null）被写入，未探测到的字段保留先前值。

#### 原则五：持久化安全

`persistSelectorCache()` 使用 `writeFileSync` + `try/catch`，不因磁盘错误影响业务。`page.evaluate()` 中的字符串使用 `CSS.escape()` 转义，防止注入。

### 4.3 核心文件清单

| 文件 | 职责 | 选择器格式 |
|------|------|-----------|
| `src/selectorResolver.ts` | SelectorChain 解析引擎、策略级健康探测 | `SelectorChain[]` |
| `src/chatAutomation.ts` | Chat/Video 页面自动化 + 探测 + Shadow DOM 穿透 | `ProviderSelectors`（扁平 CSS） |
| `src/adapters/videoProvider.ts` | 视频生成页面自动化 | `SiteAutomationConfig` / 硬编码 |
| `src/adapters/imageExtractor.ts` | 图片提取（可选 SelectorChain 参数） | 硬编码 + 可选 SelectorChain |
| `src/workbench.ts` | 编排中心：overrides 管理、缓存、健康监控、桥接 | `ProviderSelectors` |
| `src/providerPresets.ts` | 预设 SiteAutomationConfig 模板（多语言） | `SelectorChain[]` |
| `src/providers.ts` | 硬编码默认值（@deprecated） | 扁平 CSS 字符串 |
| `shared/types.ts` | 类型定义（SelectorStrategy / SelectorChain / WorkbenchEvent） | TypeScript 类型 |
| `src/constants.ts` | 超时常量 + 健康监控阈值（均支持环境变量覆盖） | 数值 |

### 4.4 三种选择器格式共存

| 格式 | 使用位置 | 互转 |
|------|---------|------|
| **扁平 CSS 字符串** (`ProviderSelectors`) | chatAutomation, workbench, selector-cache.json | `selectorToChain()` 可自动识别 `text=`/`role=`/`testid=`/`xpath=` 前缀 |
| **SelectorChain 数组** (`SiteAutomationConfig`) | providerPresets, selectorResolver, selector-cache.json (`chains` 字段) | `chainToSelector()` 转换（丢失优先级信息） |
| **硬编码列表** | videoProvider, imageExtractor | 无法自动转换 |

**缓解措施**：`getSelectors()` 优先从预设获取；`getActiveSelectorChain(field)` 提供完整 SelectorChain 访问；`selectorChainCache` 保持内部 chain 缓存。

---

## 5. 问题分析

### 5.1 故障现象

本次问题不是执行失败，而是**检测层失效**。具体表现为：

* 页面上已经出现回复内容（诊断截图可见 `{"safe": true, "reason": "none"}`）；
* 自动化等待逻辑仍然认为"响应未出现"；
* 最终报出 `send_prompt_response_never_appeared`，120s 超时。

### 5.2 根因拆解

| 编号 | 根因 | 影响 |
|------|------|------|
| RC-1 | `autoDetectSelectors()` 的 responseBlock 探测列表含有 `[class*="assistant"]`，该选择器在 Gemini 上匹配了非响应元素（品牌图标等） | 探测到错误的 selector |
| RC-2 | 错误 selector 被 `persistSelectorCache()` 写入 `selector-cache.json`，并在启动时由 `loadSelectorCache()` 加载，覆盖了正确的预设 SelectorChain | 错误被缓存放大，持续污染 |
| RC-3 | SPA 页面发送 prompt 后重建 DOM，导致响应元素计数短暂下降（`currentCount < beforeCount`），等待逻辑的 `currentCount > beforeCount` 永远不成立 | 即使 selector 正确也无法检测到响应 |

### 5.3 失败模式分类

| 类型 | 描述 | 本次是否涉及 |
|------|------|:---:|
| **Selector 误探测** | 自动探测命中了非目标元素 | ✅ RC-1 |
| **Cache 污染** | 错误结果被持久化并在重启后继续生效 | ✅ RC-2 |
| **SPA 重渲染基线失效** | 页面重建导致元素计数回退，观察逻辑失真 | ✅ RC-3 |
| **False Negative** | 目标存在但检测逻辑报告不存在 | ✅ RC-1 + RC-3 |
| **Selector 语义漂移** | 原先有效的 selector 因页面改版不再匹配目标 | ❌ |

> 本次故障是 **误探测 → 缓存污染 → 重渲染基线失效** 的复合故障链，不是"Gemini 偶发抽风"，而是一个可复现、可归类、可预防的系统性问题。

---

## 6. 设计方案

### 6.1 总体策略

采用"三层防护"设计，分别防御三个根因：

```
┌─────────────────────────────────────────────────┐
│ 防护层 1：探测层收敛（针对 RC-1）                  │
│   移除过于宽泛的 responseBlock 探测规则            │
├─────────────────────────────────────────────────┤
│ 防护层 2：缓存层防污染（针对 RC-2）                │
│   内置 provider 的 responseBlock 不允许缓存覆盖    │
├─────────────────────────────────────────────────┤
│ 防护层 3：等待层容错（针对 RC-3）                  │
│   响应等待支持基线回退和页面重渲染                  │
└─────────────────────────────────────────────────┘
```

### 6.2 方案一：收敛 responseBlock 自动探测

**目标**：避免自动探测将"看起来像 assistant"的元素误判为回复区域。

**变更**：

* 移除 `[class*="assistant"]`、`[class*="response"]`、`[class*="message-content"]`、`[class*="answer"]` 等过于宽泛的 class 匹配。
* 替换为更语义化的选择器列表：
  * `[data-message-author-role="assistant"]`
  * `message-content [class*="markdown"]`
  * `.model-response-text`
  * `.ds-markdown`
  * `[class*="response-container"] [class*="markdown"]`
  * `[class*="chat-message"]`
  * `.prose`

**变更文件**：`src/chatAutomation.ts` — `autoDetectSelectors()` 内的 `responseSelectors` 数组。

### 6.3 方案二：内置 provider 的 responseBlock 预设保护

**目标**：防止自动探测结果污染已验证过的多策略预设链。

**变更**：

* `applyDetectedSelectors()`：对内置 provider（`getPreset(provider)` 非空），跳过 `responseBlock` 字段的覆盖写入。
* `loadSelectorCache()`：加载缓存时，对内置 provider 删除 `responseBlock` 字段后再合并到 `selectorOverrides`。
* AiResource 桥接：同步跳过内置 provider 的 `responseBlock` 更新。
* 自定义 provider 不受此限制，仍允许自动探测 responseBlock。

**变更文件**：`src/workbench.ts` — `applyDetectedSelectors()` + `loadSelectorCache()`。

### 6.4 方案三：响应等待逻辑容错

**目标**：解决 SPA 重渲染导致的响应计数回退问题。

**变更**：

* 在 `sendPrompt()` 的等待循环中，增加 `adjustedBeforeCount` 变量。
* 当检测到 `currentCount < adjustedBeforeCount` 时，将 `adjustedBeforeCount` 重置为 `currentCount`。
* 继续等待后续 `currentCount > adjustedBeforeCount` 的检测。
* 相关情况记录 `send_prompt_count_regression` 警告日志。

**变更文件**：`src/chatAutomation.ts` — `sendPrompt()` 响应等待循环。

---

## 7. 实施状态

### 7.1 已完成（全部已上线）

#### Phase 1 — 基础探测扩展

| 完成项 | 文件 |
|--------|------|
| `autoDetectVideoSelectors()` 函数 + `DetectedVideoSelectors` 接口 | `chatAutomation.ts` |
| 选择器缓存持久化 `loadSelectorCache()` / `persistSelectorCache()` | `workbench.ts` |
| 健康监控 `startHealthMonitor()` / `checkSelectorHealth()` | `workbench.ts` |
| 视频探测接入 `applyDetectedVideoSelectors()` | `workbench.ts` |

#### Phase 1.5 — 审计修复

| 完成项 | 文件 |
|--------|------|
| `ensureBrowser()` 按资源类型分发探测 | `workbench.ts` |
| `extractLatestImage()` 支持 SelectorChain 参数 | `imageExtractor.ts` |
| 探测结果桥接 AiResource.selectors | `workbench.ts` |
| `probeSelectors()` 策略级粒度 + 降级检测 | `selectorResolver.ts` |
| 缓存保留完整 SelectorChain（`chains` 字段） | `workbench.ts` |
| `lastWorked`/`failCount` 策略追踪持久化 | `workbench.ts` |
| 健康监控阈值常量化 + 环境变量覆盖 | `constants.ts` |
| `selectors_updated` SSE 事件 | `types.ts`, `workbench.ts` |
| `selectorToChain()` 前缀自动识别 | `selectorResolver.ts` |
| Shadow DOM 穿透 `querySelectorAllDeep()` | `chatAutomation.ts` |
| ChatGPT / Klingai 多语言预设变体 | `providerPresets.ts` |

#### Phase 2 — 解析链优化 + 预设保护

| 完成项 | 文件 |
|--------|------|
| `getSelectors()` 优先使用 PROVIDER_PRESETS | `workbench.ts` |
| `getActiveSelectorChain(field)` 返回完整 SelectorChain | `workbench.ts` |
| `chatAdapter.generateImage()` 接入 SelectorChain | `chatAdapter.ts` |
| WorkbenchEvent 统一定义移至 `shared/types.ts` | `shared/types.ts` |
| responseBlock 自动探测列表收敛 | `chatAutomation.ts` |
| 内置 provider responseBlock 预设保护 | `workbench.ts` |
| 响应等待计数回退容错 | `chatAutomation.ts` |

### 7.2 保留问题（故意不做）

| 项目 | 原因 |
|------|------|
| `selectVideoOptions()` 仍以文本搜索为主 | 文本搜索弹性更高，selector 化反而更脆弱 |
| `modelPickerTrigger` / `modelOptionSelector` 不强制自动探测 | 需用户交互才可见，探测时机不确定 |
| `quotaExhaustedIndicator` 不自动探测 | 仅在配额耗尽时出现，无法常规探测 |
| `ProviderSelectors` 字段不统一为 `SelectorChain` | 改造面 15+ 处，已有 `getActiveSelectorChain()` 替代方案 |

---

## 8. 技术细节

### 8.1 选择器缓存

**路径**：`data/selector-cache.json`

**格式**：
```json
{
  "chatgpt": {
    "selectors": {
      "promptInput": "#prompt-textarea",
      "sendButton": "button[data-testid=\"send-button\"]"
    },
    "chains": {
      "sendButton": [
        { "selector": "button[data-testid=\"send-button\"]", "method": "css", "priority": 5, "lastWorked": "2026-04-11T10:30:00.000Z", "failCount": 0 },
        { "selector": "Send prompt", "method": "text", "priority": 4 }
      ]
    },
    "detectedAt": "2026-04-11T10:30:00.000Z"
  }
}
```

**生命周期**：

| 阶段 | 触发点 | 行为 |
|------|--------|------|
| **加载** | `new Workbench()` → `loadSelectorCache()` | 合并到 `selectorOverrides` + `selectorChainCache`；⚠️ 内置 provider 跳过 `responseBlock` |
| **写入** | `applyDetected*()` → `persistSelectorCache()` | ⚠️ 内置 provider 的 `responseBlock` 不写入 overrides |
| **追踪** | `checkSelectorHealth()` → `persistSelectorCache()` | 更新 `lastWorked`/`failCount` 到 `selectorChainCache` |

### 8.2 健康监控

```
Workbench.start()
    ├──→ startHealthMonitor()
    │         └──→ setInterval(checkSelectorHealth, INTERVAL_MS)
    │                   ├──→ probeSelectors(page, chains) → 逐策略探测
    │                   ├──→ 更新 selectorChainCache (lastWorked/failCount)
    │                   ├──→ score < WARN_THRESHOLD → SSE selector_health_warning
    │                   └──→ score < REDETECT_THRESHOLD → 按资源类型重探测
    │
Workbench.stop()
    └──→ stopHealthMonitor()
```

**阈值常量**（`src/constants.ts`，支持环境变量覆盖）：

| 常量 | 默认值 | 环境变量 |
|------|--------|---------|
| `SELECTOR_HEALTH_CHECK_INTERVAL_MS` | 300,000 (5 min) | `SELECTOR_HEALTH_CHECK_INTERVAL_MS` |
| `SELECTOR_HEALTH_WARN_THRESHOLD` | 80 | `SELECTOR_HEALTH_WARN_THRESHOLD` |
| `SELECTOR_HEALTH_REDETECT_THRESHOLD` | 60 | `SELECTOR_HEALTH_REDETECT_THRESHOLD` |

### 8.3 探测接入点

```
ensureBrowser(account)
    ├──→ resource.type === 'video' || 'image' ?
    │         ├──→ YES: autoDetectVideoSelectors(page) → applyDetectedVideoSelectors()
    │         └──→ NO:  autoDetectSelectors(page)      → applyDetectedSelectors()
    │
    └──→ 两条路径均触发：selectorOverrides 更新 + AiResource 桥接 + SSE 事件 + 持久化
```

---

## 9. 风险与控制措施

| 风险 | 描述 | 控制措施 |
|------|------|---------|
| **Cache 污染** | 错误探测结果写入缓存后重启持续生效 | 内置 provider 的 responseBlock 不允许缓存覆盖；健康监控异常触发重探测 |
| **Selector 误判** | 页面改版后 selector 命中非目标元素 | 多策略 SelectorChain 降级；降低对单一类名选择器的依赖；增加语义属性选择器 |
| **SPA 重渲染** | 页面刷新后计数下降导致误判超时 | 计数回退容错 + 基线重置 |
| **格式转换损失** | `chainToSelector()` 丢失优先级信息 | `getActiveSelectorChain()` 提供完整 SelectorChain 直接访问 |

---

## 10. 覆盖矩阵

### 10.1 全字段覆盖状态

| 字段 | 路径 | 自动探测 | 预设 | 硬编码 | 状态 |
|------|------|:---:|:---:|:---:|------|
| promptInput | Chat + Video | ✅ | ✅ | ✅ | **完全覆盖** |
| sendButton | Chat | ✅ | ✅ | ✅ | 完全覆盖 |
| responseBlock | Chat | ✅ ⚠️ | ✅ | ✅ | 完全覆盖（内置 provider 预设优先） |
| readyIndicator | Chat | ✅ | ✅ | ✅ | 完全覆盖 |
| fileUploadTrigger | Chat | ✅ | ✅ | ✅ | 完全覆盖 |
| generateButton | Video | ✅ | ✅ | ✅ | 完全覆盖 |
| imageUploadTrigger | Video | ✅ | ✅ | ✅ | 完全覆盖 |
| videoResult | Video | ✅ | ✅ | ✅ | 完全覆盖 |
| progressIndicator | Video | ✅ | ✅ | — | 探测 + 预设覆盖 |
| downloadButton | Video | ✅ | ✅ | — | 探测 + 预设覆盖 |
| modelPickerTrigger | Chat | — | ✅ | ✅ | 仅预设/硬编码（架构边界） |
| modelOptionSelector | Chat | — | ✅ | ✅ | 仅预设/硬编码（架构边界） |
| quotaExhaustedIndicator | Chat | — | ✅ | ✅ | 仅预设/硬编码（架构边界） |
| imageFinding | Image | — | — | ✅ | 纯 DOM 计算（保持） |

### 10.2 就绪度

| 组件 | 状态 | 说明 |
|------|------|------|
| Chat 自动探测 | 🟢 可用 | 5/8 字段，Shadow DOM 穿透，responseBlock 预设保护 |
| Video 自动探测 | 🟢 可用 | 6/6 字段，双入口接入，AiResource 桥接 |
| Image 自动探测 | 🟢 可用 | SelectorChain 参数，chatAdapter 已接入 |
| 健康监控 | 🟢 可用 | 策略级粒度 + 降级检测 + 按资源类型重探测 |
| 选择器缓存 | 🟢 可用 | 完整 SelectorChain + 策略追踪 + 防污染 |
| 探测结果桥接 | 🟢 可用 | selectorOverrides + AiResource.selectors 同步更新 |
| 事件通知 | 🟢 可用 | `selectors_updated` + `selector_health_warning` SSE |

---

## 11. 设计决策记录

| 决策 | 理由 |
|------|------|
| 保留 `ProviderSelectors` 为扁平 API | 改造面 15+ 处，已有 `getActiveSelectorChain()` 替代 |
| 不迁移 `selectVideoOptions()` | 文本搜索弹性更高 |
| 预设优先于自动探测（responseBlock） | 防止低质量探测结果污染核心检测逻辑 |
| `WorkbenchEvent` 统一到 `shared/types.ts` | 消除前后端定义不同步风险 |

---

## 12. 后续优化建议

1. **Selector cache 版本号**：为缓存文件引入 schema version，应用升级时自动失效旧格式缓存。
2. **探测置信度评分**：为自动探测结果增加置信度标记（如匹配元素数、内容长度），供健康监控参考。
3. **responseBlock 内容辅助判断**：在探测时检查候选元素是否包含有意义的文本内容，减少纯 selector 匹配的误判。
4. **故障 taxonomy 沉淀**：将本次问题分类（§5.3）纳入运维手册，便于后续排障。

---

## 13. 结论

DOM 探测系统是整个免费自动化链路的关键基础设施。本次变更的重点不是"多加几个 selector"，而是建立一套更可靠的机制：

* 自动探测不能盲目覆盖预设；
* 错误缓存不能持续污染系统；
* 响应等待必须容忍 SPA 重渲染；
* 探测结果要能监控、持久化、回退和重探测。

这使系统从"可用但脆弱"提升为"具备自愈能力的基础设施组件"，具备了更强的长期演进能力。
