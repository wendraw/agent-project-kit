---
name: experience-retrieve
description: Retrieve relevant experience from context index before phase execution.
---

# experience-retrieve

## 目标
在每个阶段执行前，自动检索已有经验，提供 Retrieved Context 摘要，让 Agent 避免重复踩坑。

## 必要输入
- 需求 ID（用于提取关键词）
- `context/index.json`（经验索引）
- 当前阶段 key（intake/design/breakdown/implementation/validation/completion）

## 检索算法

1. **读取索引**：读取 `context/index.json` 的 `entries` 数组。
2. **关键词匹配**：从当前需求的 `00-intake.md`（若存在）提取领域关键词；用这些关键词与每条 entry 的 `title`、`tags`、`domain` 做模糊匹配。
3. **阶段过滤**：
   - `stage == "rules"` 的条目始终包含（规则对所有阶段适用）。
   - 其余条目按 `stage` 与当前阶段的关联性过滤：
     - intake/design → `decision`, `task-input`, `rules`
     - breakdown → `task-input`, `rules`
     - implementation → `task-input`, `rules`
     - validation/completion → `rules`
4. **Risk 优先**：若 entry 的 `tags` 包含 `risk` 或 `path` 包含 `risk`，标记为 `⚠ RISK`。
5. **命中计数**：每条被匹配的 entry，在 `index.json` 中递增其 `hit_count` 字段（若无则初始化为 1）。同时更新 `last_hit_at` 为当前时间戳。此数据供 `knowledge-evolution` skill 分析升级候选。
6. **预算感知输出**：
   - 默认最多输出 10 条匹配结果，每条仅含 `id`、`title`、`tags`、`path`、风险标记。
   - 若启用 `context-budget` skill，按 L0 预算（~500 tokens）裁剪：超出时优先保留 Risk 条目，其次按 `hit_count` 降序保留高频条目，截断至预算内。

## 输出格式

```markdown
## Retrieved Context

| # | ID | Title | Tags | Risk | Path |
|---|---|---|---|---|---|
| 1 | rules-risk-rules | risk rules | — | ⚠ RISK | assets/rules/risk-rules.md |
| 2 | pat-contract-first | Pattern - Contract First | api, contract | — | assets/patterns/pattern-contract-first.md |

> 共匹配 N 条经验。如需深入了解，请读取对应 path 文件。
```

## 完成标准
- 输出 Retrieved Context 摘要块（即使匹配 0 条也要显式声明"无匹配经验"）。
- 摘要在 500 tokens 以内。
- Risk 类条目排在最前。
