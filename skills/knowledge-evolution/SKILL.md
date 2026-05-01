---
name: knowledge-evolution
description: Track experience retrieval frequency and recommend Doc → Skill → Command upgrades.
---

# knowledge-evolution

## 目标
追踪经验条目的命中频次，当某条经验被反复检索时，推荐将其从文档升级为 Skill 或 Command，实现知识的自然演进。

## 演进阈值

| 当前形态 | 命中次数 | 推荐动作 |
|----------|----------|----------|
| Doc（experience record） | >= 5 | 候选升级为 Skill（封装为可复用指令） |
| Skill | >= 10 | 候选升级为 Command（封装为一键入口） |
| Rule | >= 3 | 候选固化到 Agent 合约的 Hard Rules |

## 必要输入
- `context/index.json`（含 `hit_count` 和 `last_hit_at` 字段）

## 执行清单

1. **扫描索引**：读取 `index.json`，筛选 `hit_count` 大于 0 的条目。

2. **生成演进报告**：

   ```markdown
   ## Knowledge Evolution Report

   ### Skill 升级候选（hit_count >= 5）
   | ID | Title | Hits | Last Hit | Current Form | Path |
   |---|---|---|---|---|---|
   | pat-contract-first | Contract First | 7 | 2026-02-27 | pattern | assets/patterns/... |

   ### Command 升级候选（hit_count >= 10）
   （无）

   ### Rule 固化候选（hit_count >= 3）
   | ID | Title | Hits | Current Form | Path |
   |---|---|---|---|---|
   | rules-risk-rules | risk rules | 4 | rules | assets/rules/... |

   > 共 N 条候选。执行升级请使用 `meta-maintainer` skill。
   ```

3. **标记候选**：在 `index.json` 对应条目中追加 `evolution_candidate` 字段：
   ```json
   {
     "evolution_candidate": "skill",
     "evolution_reason": "hit_count=7, threshold=5"
   }
   ```

## 触发时机
- 在 `archive` 阶段（需求归档时）自动执行一次，作为需求复盘的一部分。
- 可通过 `/optimize-flow` 手动触发。

## 完成标准
- 输出 Knowledge Evolution Report。
- 达到阈值的条目已标记 `evolution_candidate`。
- 报告中明确下一步动作（由 `meta-maintainer` 执行实际升级）。
