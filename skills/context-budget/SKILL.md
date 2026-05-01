---
name: context-budget
description: Manage token budgets for context injection to prevent context window pollution.
---

# context-budget

## 目标
控制每次注入 Agent 上下文的 token 总量，防止上下文腐蚀和注意力预算耗尽。

## 预算模型

### 分层预算

| 层级 | 内容 | 预算上限 | 说明 |
|------|------|----------|------|
| L0: 索引层 | index.json 摘要、Retrieved Context 表格 | ~500 tokens | 始终加载，成本固定 |
| L1: 合约层 | Agent 合约 + Skill 指令 | ~1500 tokens | 按阶段加载，每次 1 个 Agent + 2-3 个 Skills |
| L2: 动态层 | 需求产物片段、经验全文 | ~3000 tokens | 按需加载，仅在 Agent 主动请求时拉取 |
| 总计 | — | ~5000 tokens | 单次 Subagent Dispatch 的上下文注入上限 |

### 阶段预算权重

不同阶段对上下文的需求不同：

| 阶段 | L0 | L1 | L2 | 总预算 |
|------|-----|------|------|--------|
| intake | 500 | 1000 | 1500 | 3000 |
| design | 500 | 1500 | 3000 | 5000 |
| breakdown | 500 | 1500 | 2000 | 4000 |
| implementation | 500 | 1500 | 3000 | 5000 |
| validation | 500 | 1000 | 1000 | 2500 |
| completion | 500 | 1000 | 1500 | 3000 |

## 执行清单

1. **估算当前注入量**：
   - 统计 Retrieved Context 表格的行数（每行约 50 tokens）。
   - 统计 Agent 合约和 Skill 指令的字符数（中文约 1.5 char/token，英文约 4 char/token）。
   - 统计需求产物片段的字符数。

2. **裁剪策略**（当超出预算时）：
   - **L0 裁剪**：减少 Retrieved Context 匹配条目数（从 10 条缩减到 5 条），优先保留 Risk 条目。
   - **L1 裁剪**：仅保留当前阶段 primary_skills 的 SKILL.md，optional_skills 仅保留名称引用。
   - **L2 裁剪**：不预加载需求产物全文，仅提供路径列表，由 Agent 按需读取。

3. **输出预算报告**：
   ```
   Context Budget: 3200/5000 tokens (64%)
   - L0 Index: 450/500
   - L1 Contracts: 1200/1500
   - L2 Dynamic: 1550/3000
   ```

## 完成标准
- 每次 Subagent Dispatch 的上下文注入不超过该阶段的总预算。
- 预算报告附在 Subagent prompt 之前（仅调试用，不注入 Agent 上下文）。
- Risk 条目在任何裁剪策略下都不被移除。
