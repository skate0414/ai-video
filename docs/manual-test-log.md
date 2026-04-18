# 有大量自动记录能力了，关键是**知道去哪里看、补充记录什么**。

---

## 系统已自动记录的数据

| 数据 | 位置 | 内容 |
|------|------|------|
| 每阶段日志 | `data/logs/{projectId}.jsonl` | 阶段名、开始/结束时间、成功/失败、错误信息 |
| 成本明细 | `data/cost-audit/` | 每次 AI 调用的提供者、模型、耗时、费用 |
| 全量中间产物 | `data/projects/{id}/` 下所有 `.json` 文件 | style-profile、research、narrative-map、script、script.cir、scenes、temporal-plan 等 |
| 脚本版本历史 | `data/projects/{id}/script-history.json` | AI 原始版本 + 每次编辑后版本 |
| Trace 诊断 | ReplayPage | span 级别的调用链、耗时、失败点 |

## 你需要手动补充记录的（一个文件搞定）

创建一个 `data/manual-test-log.md`，每个视频一个区块，**跑之前写上面，跑完写下面**：

```markdown
# 手动测试记录

## 视频 1：你的身体有多爱你 → 免疫系统有多拼命
- 项目 ID: ______
- 开始时间: ______
- 参考视频: 你的身体有多爱你.mp4
- 新主题: 生而为人有多难得
- 风格模板: [新建 / 从视频1保存的模板]

### 各阶段检查点（跑到暂停点时填写）

**STYLE_EXTRACTION → SCRIPT_GENERATION（第一个暂停点）**
- [ ] 风格提取是否完成？耗时约___分钟
- [ ] FormatSignature 是否合理？（看 style-profile.json 的 track_a）
- [ ] 有无阶段报错？错误信息：______
- [ ] 骨架生成是否成功？场景数：___
- [ ] 写作生成是否成功？总字数：___
- [ ] QA 评分：overall=___ / 子分=___
- [ ] QA 是否通过？[通过 / 拒绝→原因___ / 手动覆盖→原因___]
- [ ] 脚本质量主观评价（1-5）：___
- [ ] 脚本问题标签：[hook_weak / pacing_slow / too_similar_ref / language_stiff / 无]
- [ ] 是否编辑脚本？改了什么：______

**STORYBOARD → REFERENCE_IMAGE（第二个暂停点）**
- [ ] 分镜场景数：___
- [ ] visualPrompt 质量（1-5）：___
- [ ] 参考图一致性（主观）：___
- [ ] 拒绝/重新生成了几个场景：___ 原因：______
- [ ] 是否修改了 visualPrompt：______

**KEYFRAME → ASSEMBLY（最终）**
- [ ] 视频生成成功场景数：___ / 总场景数：___
- [ ] 有无场景重新生成：___次
- [ ] TTS 是否正常？
- [ ] 最终视频时长：___秒
- [ ] 总耗时：___分钟
- [ ] 最终质量主观评价（1-5）：___

### 发现的问题
| 问题 | 阶段 | 严重度 | 是系统bug还是质量问题 |
|------|------|--------|---------------------|
|      |      |        |                     |

---
## 视频 2：心脏：主人你好，我有话对你说（data/uploads/心脏：主人你好，我有话对你说.mp4） → 肾脏：主人你好，我有话对你说
（同上结构）

---
## 视频 3：Understanding Type 2 Diabetes → Understanding Hypertension
（同上结构）
```

## 跑完 3 个视频后的系统诊断清单

用已有工具检查，不需要写代码：

**1. 看日志有无隐藏错误**
```bash
# 搜索所有项目日志中的 error/warning
grep -i '"level":"error\|"level":"warn' data/logs/*.jsonl
```

**2. 看成本异常**
```bash
# 查看各项目成本对比（某个项目异常高=可能有大量重试）
cat data/cost-audit/global-audit.json | jq '.byProject'
```

**3. 对比 3 个项目的阶段耗时**
```bash
# 从日志提取每阶段耗时
for f in data/logs/*.jsonl; do
  echo "=== $f ==="
  jq -r 'select(.stage) | "\(.stage) \(.duration // "N/A")"' "$f"
done
```

**4. 检查 QA 评分分布**
```bash
# 看 3 个项目的 QA 审核结果
for d in data/projects/*/; do
  echo "=== $(basename $d) ==="
  cat "$d/qa-review.json" | jq '{overall: .overall_score, subs: .sub_scores}'
done
```

**5. 检查脚本污染**
```bash
# 看脚本验证结果中的 n-gram 污染和源标记
for d in data/projects/*/; do
  echo "=== $(basename $d) ==="
  cat "$d/script.cir.json" | jq '.validation // empty'
done
```

---

## 核心原则

**系统数据你不用操心**——日志、artifact、成本全部自动记录。

**你唯一要补的是主观判断和决策理由**——"脚本质量几分"、"为什么覆盖 QA"、"为什么拒绝这个场景"。这些是机器无法记录的，也是后续优化 prompt 的最关键输入。

3 个视频跑完后，把 `manual-test-log.md` + 上面 5 个命令的输出发给我，我可以帮你定位系统级问题和优化方向。 

