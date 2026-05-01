---
name: experience-index
description: Extract reusable learnings and write back records/rules into context index.
---

# experience-index

## 目标
将当前需求经验沉淀到 context，并可被下次检索。

## 必要输入
- 需求 ID
- 至少一条可复用 insight

## 执行清单
1. 运行 `agentkit optimize-flow --id <req-id> --insight ...`。
2. 确认 `context/records/experience/` 产生新记录。
3. 确认 `context/index.json` 已更新。

## 完成标准
- 新经验可在 index 中检索到。
- 规则无明显冲突或已标记冲突。
