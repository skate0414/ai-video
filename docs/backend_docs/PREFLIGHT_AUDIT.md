# Pre-Compilation Audit Report

> 审计日期: 2026-04-10
> 范围: 全仓启动路径 + 首编译依赖 + 认证/配置/状态恢复/状态机
> 测试基准: 565 tests passing, 38 files, tsc clean

---

## 1. PRE-FLIGHT BLOCKERS — 必须在任何 trial run 前修复

### B1 · ELECTRON_AUTOMATION_TOKEN 未传递给后端子进程

| 项 | 内容 |
|---|---|
| **文件** | [browser-shell/src/backend-launcher.ts](../../../browser-shell/src/backend-launcher.ts) L72-91 |
| **故障条件** | `backendEnv` 白名单不含 `ELECTRON_AUTOMATION_TOKEN`。后端进程的 `process.env.ELECTRON_AUTOMATION_TOKEN` 为空字符串。 |
| **失败路径** | `electronBridge.ts` L196 读取 `''` → L197 不发送 `Authorization` header → `automation-server.ts` L56 返回 **401** → **全部 tab 创建/关闭/列举请求失败** → Electron 内部浏览器自动化完全不可用 |
| **影响** | **全 pipeline 不可用** — ChatAdapter 依赖 `acquireElectronContext()` 来获取 Playwright Page，而后者依赖 `controlRequest()` |
| **是否 fail-closed** | 是 — 首次 `controlRequest` 抛 Error (HTTP 401)，stage 失败 |
| **复现** | 启动 Electron 桌面模式 → 触发任意 pipeline → 观察 backend stdout `[ElectronBridge] Control request POST /automation/tabs failed: 401` |
| **修复** | 在 `backend-launcher.ts` L85-91 pass-through 数组中加入 `'ELECTRON_AUTOMATION_TOKEN'` |

### B2 · scripts/start.sh 有 bash 语法错误

| 项 | 内容 |
|---|---|
| **文件** | [scripts/start.sh](../../../scripts/start.sh) L80 |
| **故障条件** | 文件末尾有一个孤立的 `fi`，不与任何 `if` 匹配 |
| **影响** | `bash -n scripts/start.sh` 返回 exit 2。脚本无法执行。 |
| **复现** | `bash -n scripts/start.sh` → `line 72: syntax error near unexpected token 'fi'` |
| **修复** | 删除末尾多余的 `fi` |

### B3 · Stage Registry 静默空注册 → 假 "pipeline_complete"

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/orchestrator.ts](../../pipeline/orchestrator.ts) L340-354 + [src/pipeline/stageRegistry.ts](../../pipeline/stageRegistry.ts) L67-80 |
| **故障条件** | `stages/defs/index.ts` 的 side-effect import 失败（某个 stage def 文件有导入错误）→ `getStageDefinitions()` 返回 `[]` → `for-of` 循环零次执行 → 发射 `pipeline_complete` 事件但无任何工作 |
| **影响** | Pipeline 报告成功但未执行任何阶段。用户看到"完成"但无输出。 |
| **是否 fail-closed** | **否 — fail-open。** 这是最危险的类型：假阳性成功。 |
| **复现** | 在 registry 中所有 stage 注册前调用 `getStageDefinitions()` → 验证返回值非空 |
| **推荐** | 在 `orchestrator.run()` 入口处添加断言：`if (stages.length === 0) throw new Error('No stages registered')` |

### B4 · 首阶段 CAPABILITY_ASSESSMENT 要求活跃 AI 适配器但无预检

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/stages/defs/analysisStages.ts](../../pipeline/stages/defs/analysisStages.ts) L27 + [src/pipeline/stages/capabilityAssessment.ts](../../pipeline/stages/capabilityAssessment.ts) L51 |
| **故障条件** | 零浏览器连接 + 无 Gemini API key → `getSessionAwareAdapter()` 获取到的 adapter `generateText()` 调用挂起或抛错 |
| **影响** | Pipeline 在首阶段立刻失败，用户可能等待 120 秒超时才看到错误。无提前检测。 |
| **推荐** | 在 `startPipeline()` 前添加 preflight check：至少一个 provider 有 `text: true` 能力且 adapter 可达 |

### B5 · 零 provider 预设有 videoGeneration: true

| 项 | 内容 |
|---|---|
| **文件** | [data/provider-presets.json](../../../data/provider-presets.json) |
| **故障条件** | 四个内置 provider (gemini, chatgpt, deepseek, kimi) 均 `videoGeneration: false`。VIDEO_GEN 阶段无内置 provider 可选。 |
| **影响** | 除非用户手动配置外部视频 provider（Kling/Vidu 等），VIDEO_GEN 阶段一定失败。无早期提示。 |
| **推荐** | 在 pipeline preflight 中检查 `resourcePlanner.plan(getStageOrder()).allFeasible`，并对 blockers 提前报错 |

### B6 · dataDir mkdirSync 无权限保护

| 项 | 内容 |
|---|---|
| **文件** | [src/dataDir.ts](../../dataDir.ts) L50-52 |
| **故障条件** | `mkdirSync(dir, { recursive: true })` 在权限不足时抛 `EACCES`，错误消息不友好 |
| **影响** | Server 启动 crash — `resolveDataDir()` 在 `server.ts L41` 被调用，错误不含 "data directory permission" 上下文 |
| **推荐** | 在 `resolveDataDir()` 中 wrap mkdirSync with try/catch + 清晰的权限错误消息 |

---

## 2. PRE-FLIGHT WARNINGS — 应尽快修复

### W1 · `runWithAICallControl` 超时不取消底层操作

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/aiControl.ts](../../pipeline/aiControl.ts) L83-98 |
| **条件** | AI 请求超时 → wrapper promise reject → 但底层 Playwright 页面/HTTP 请求继续运行 |
| **影响** | 资源泄漏：浏览器标签页、网络连接在超时后仍活跃。重试可能与残留操作冲突。 |

### W2 · PipelineService fire-and-forget 隐藏失败

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/pipelineService.ts](../../pipeline/pipelineService.ts) L108-112, L133-136, L147-150 |
| **条件** | `startPipeline()`, `retryStage()`, `resumePipeline()` 返回 `{ ok: true }` 后 `.catch()` 吞掉错误 |
| **影响** | 调用者（API）报告启动成功，但 pipeline 可能已经失败。SSE 事件可能发送了 `pipeline_error`，但 HTTP response 200 已经返回。 |

### W3 · SessionManager.saveTo 保存全部 session 到单项目目录

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/sessionManager.ts](../../pipeline/sessionManager.ts) L143-149 |
| **条件** | 多项目并行 → 所有 session 写入任一 `projectDir/sessions.json` |
| **影响** | 恢复时加载到不属于该项目的 session 数据 | 

### W4 · SessionManager.loadFrom 无结构校验

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/sessionManager.ts](../../pipeline/sessionManager.ts) L162-170 |
| **条件** | `sessions.json` 有合法 JSON 但错误结构 → `{ key: undefined, value: undefined }` 解构 → `Map.set(undefined, undefined)` |
| **影响** | session map 被 undefined 键污染，后续查找行为异常 |

### W5 · ProviderRegistry 空注册无错误

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/providerRegistry.ts](../../pipeline/providerRegistry.ts) L95-98 |
| **条件** | `seedFromAccounts([])` → registry 为空 → `findProviders()` 永远返回 `[]` |
| **影响** | 所有 AI 阶段在 adapter resolution 时逐一失败，无集中的 "no providers" 报错 |

### W6 · staleProject 恢复假设 processing 状态

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/orchestrator.ts](../../pipeline/orchestrator.ts) L200-213 |
| **条件** | 某 stage 在非 `processing` 状态下被视为 stale → `transitionStage(current, 'error')` → `InvalidStageTransitionError` |
| **影响** | 该项目的恢复被跳过（catch 忽略），但其他 stale 项目可正常恢复 |

### W7 · CIR 解析器默认值掩盖缺失数据

| 项 | 内容 |
|---|---|
| **文件** | [src/cir/parsers.ts](../../cir/parsers.ts) L31-34 |
| **条件** | `StyleProfile` 缺少 `meta`、`track_a/b/c` → 全部 fallback 到硬编码默认值 |
| **影响** | 下游阶段收到 "plausible-sounding" 但不准确的 CIR → 视频质量降级无预警 |

### W8 · CAPABILITY_ASSESSMENT 安全检查 fail-open

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/stages/capabilityAssessment.ts](../../pipeline/stages/capabilityAssessment.ts) L55 |
| **条件** | AI 返回不可解析 JSON → `JSON.parse` catch → 默认 `{ safe: true }` |
| **影响** | 不安全主题通过安全检查 |

### W9 · safety middleware `requiresManualReview` 无下游强制执行

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/safety.ts](../../pipeline/safety.ts) L147 |
| **条件** | 自杀/医疗内容 → `requiresManualReview = true` → 但调用方未检查 |
| **影响** | 危险内容可能生成视频而无人工审核 |

### W10 · RunLock 无超时终止机制

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/runLock.ts](../../pipeline/runLock.ts) L14-22 |
| **条件** | Stage 无限挂起 → lock 永不释放 → 该 projectId 后续运行永远被阻塞 |
| **影响** | 需要重启进程才能恢复该项目 |

### W11 · backend-launcher 崩溃重启无退避/上限

| 项 | 内容 |
|---|---|
| **文件** | [browser-shell/src/backend-launcher.ts](../../../browser-shell/src/backend-launcher.ts) L106-112 |
| **条件** | 缺失依赖导致 backend 启动即崩 → 每 2 秒无限重启 |
| **影响** | CPU 空转，日志暴涨 |

### W12 · CDP 端口冲突无检测

| 项 | 内容 |
|---|---|
| **文件** | [browser-shell/src/main.ts](../../../browser-shell/src/main.ts) L46 |
| **条件** | 端口 9222 被占用 → Electron CDP 静默失败 → Playwright 无法连接 |
| **影响** | 浏览器自动化全部失败，错误延迟到 `waitForCdpReady` 超时 (60 秒) 才暴露 |

### W13 · Electron 健康检查失败非阻塞

| 项 | 内容 |
|---|---|
| **文件** | [browser-shell/src/main.ts](../../../browser-shell/src/main.ts) L155-159 |
| **条件** | `waitForBackend()` 返回 false → 仅 log error → UI 照常打开 |
| **影响** | 用户看到 UI 但所有 API 调用都失败 |

### W14 · start.sh 不检查 Node 版本

| 项 | 内容 |
|---|---|
| **文件** | [scripts/start.sh](../../../scripts/start.sh) L35 |
| **条件** | Node < 20 安装 → 通过检查 → 运行时可能遇到 API 不兼容 |

### W15 · start.sh 不检查 Playwright 浏览器

| 项 | 内容 |
|---|---|
| **文件** | [scripts/start.sh](../../../scripts/start.sh) |
| **条件** | `npx playwright install chromium` 未执行 → Workbench 创建 context 时抛 "executable not found" |

### W16 · stageRetryWrapper 延迟不可中断

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/stageRetryWrapper.ts](../../pipeline/stageRetryWrapper.ts) L89 |
| **条件** | pipeline abort 期间，retry backoff `setTimeout` 仍完整执行后才进入下一次重试检查 |
| **影响** | abort 可能延迟最多 `backoff` 时间才生效 |

### W17 · 视频路径无 path traversal 防护

| 项 | 内容 |
|---|---|
| **文件** | [src/pipeline/orchestrator.ts](../../pipeline/orchestrator.ts) L306-312 |
| **条件** | `videoFilePath` 含 `../../` → `join(uploads, videoFilePath)` 解析到 uploads 目录外 |
| **推荐** | 使用 `src/lib/pathSafety.ts` 校验 |

### W18 · ResourceManager corrupt file 静默替换默认数据

| 项 | 内容 |
|---|---|
| **文件** | [src/resourceManager.ts](../../resourceManager.ts) L34-39 |
| **条件** | `resources.json` corrupted → 静默用 default seed 替换 → 所有自定义资源丢失 |

### W19 · automation-server 无请求体大小限制

| 项 | 内容 |
|---|---|
| **文件** | [browser-shell/src/automation-server.ts](../../../browser-shell/src/automation-server.ts) L155-164 |
| **条件** | 恶意本地进程发送巨大 body → OOM |

### W20 · chatAdapter.assetsDir 为相对路径

| 项 | 内容 |
|---|---|
| **文件** | [src/adapters/chatAdapter.ts](../../adapters/chatAdapter.ts) L60 |
| **条件** | 默认 `'data/projects/assets'` 依赖 CWD → Electron 中 CWD 可能非预期位置 |

---

## 3. 最小 Preflight 检查清单

以下是 pipeline 启动前应执行的最小检查，建议作为 `preflight()` 函数放在 `pipelineService.ts` 或 `orchestrator.ts` 入口：

```typescript
async function preflight(config: OrchestratorConfig): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Data directory writable
  try {
    const testFile = join(config.dataDir, '.preflight-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
  } catch {
    errors.push(`Data directory not writable: ${config.dataDir}`);
  }

  // 2. Stage registry populated
  const stages = getStageDefinitions();
  if (stages.length === 0) {
    errors.push('Stage registry is empty — no pipeline stages registered');
  } else if (stages.length < 13) {
    warnings.push(`Only ${stages.length}/13 stages registered`);
  }

  // 3. At least one provider with text capability
  const textProviders = providerRegistry.findProviders({ text: true });
  if (textProviders.length === 0) {
    errors.push('No providers with text capability — pipeline cannot start');
  }

  // 4. Resource plan feasibility (for at least the first 3 stages)
  const plan = resourcePlanner.plan(stages.slice(0, 3).map(s => s.stage));
  if (!plan.allFeasible) {
    errors.push(`First stages infeasible: ${plan.blockers.join(', ')}`);
  }

  // 5. Electron auth token (when in Electron mode)
  if (process.env.ELECTRON_SHELL) {
    const token = process.env.ELECTRON_AUTOMATION_TOKEN;
    if (!token) {
      errors.push('ELECTRON_AUTOMATION_TOKEN not set — tab creation will fail with 401');
    }
  }

  // 6. Adapter reachability (lightweight ping)
  if (config.apiAdapter) {
    try {
      // Quick model list call or similar lightweight check
    } catch {
      warnings.push('Gemini API adapter initialization failed');
    }
  }

  // 7. Browser/CDP availability (Electron mode)
  if (process.env.ELECTRON_SHELL) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) warnings.push('CDP endpoint not ready');
    } catch {
      warnings.push('CDP endpoint unreachable — browser automation will fail');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
```

---

## 4. 推荐 Smoke Tests / 断言

### A. 单元级断言（加入 vitest）

```
// stageRegistry completeness
test('all 13 stages registered', () => {
  const stages = getStageDefinitions();
  expect(stages.length).toBe(13);
  expect(new Set(stages.map(s => s.stage))).toEqual(new Set(PIPELINE_STAGES));
});

// configStore migration round-trip with future version
test('migrateConfig handles v999 gracefully', () => {
  const raw = { _schemaVersion: 999, geminiApiKey: 'x' };
  const result = migrateConfig(raw);
  // Should not crash, should keep key
  expect(result.geminiApiKey).toBe('x');
});

// sessionManager loadFrom shape validation
test('loadFrom rejects entries without key/value', () => {
  writeFileSync(filePath, JSON.stringify([{ noKey: true }]));
  manager.loadFrom(projectDir);
  expect(manager.sessions.size).toBe(0); // should not pollute
});

// electronBridge token presence
test('controlRequest includes auth header when token set', () => {
  process.env.ELECTRON_AUTOMATION_TOKEN = 'test123';
  // verify the header is constructed correctly
});

// empty registry produces error not success
test('orchestrator.run() throws on empty registry', () => {
  // Mock getStageDefinitions to return []
  await expect(orchestrator.run('proj1')).rejects.toThrow(/no stages/i);
});
```

### B. Runtime 启动断言（加入 server.ts 或 main.ts）

```typescript
// server.ts startup — after const pipelineService = ...
const stageCount = getStageDefinitions().length;
if (stageCount < 13) {
  console.error(`[PREFLIGHT] Only ${stageCount}/13 pipeline stages registered. Aborting.`);
  process.exit(1);
}

// electronBridge.ts — inside controlRequest()
if (process.env.ELECTRON_SHELL && !process.env.ELECTRON_AUTOMATION_TOKEN) {
  throw new Error(
    '[PREFLIGHT] Running in Electron shell but ELECTRON_AUTOMATION_TOKEN is not set. ' +
    'Check that backend-launcher.ts passes the token to the child process.'
  );
}
```

### C. scripts/start.sh 增强检查

```bash
# Node version check
NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node.js >= 20 required (found: $(node --version))"
  exit 1
fi

# Playwright browsers
if ! npx playwright install --dry-run chromium &>/dev/null 2>&1; then
  echo "⚠️  Playwright chromium not installed. Run: npx playwright install chromium"
fi
```

---

## 附录：全部发现统计

| 等级 | 数量 | 关键项 |
|------|------|--------|
| **BLOCKER** | 6 | 认证 token 断链 (B1), start.sh 语法错误 (B2), 空 registry 假成功 (B3), 首阶段无预检 (B4), 零视频 provider (B5), dataDir 权限 (B6) |
| **WARNING** | 20 | AI 超时不取消 (W1), fire-and-forget (W2), session 全量保存 (W3), session 无校验 (W4), 空 provider 静默 (W5), stale 恢复假设 (W6), CIR 默认值 (W7), 安全检查 fail-open (W8), safety 无强制 (W9), 锁无超时 (W10), 无限重启 (W11), CDP 端口冲突 (W12), 健康检查非阻塞 (W13), Node 版本 (W14), Playwright 浏览器 (W15), retry 延迟不可中断 (W16), path traversal (W17), resources 静默替换 (W18), body 无上限 (W19), 相对路径 (W20) |
| **INFO** | ~20 | 各类边界条件、设计权衡（省略详情） |
