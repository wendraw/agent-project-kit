---
name: meta-maintainer
description: Maintain AGENTS, RFC, and skills metadata consistency across the workflow.
---

# meta-maintainer

## 目标
维护流程元信息文件，避免约束漂移。

## 必要输入
- `AGENTS.md`
- `docs/rfcs/*`
- `skills/INDEX.md`

## 执行清单
1. 校验入口约束与实际流程一致。
2. 发现差异时同步更新 AGENTS/RFC/技能索引。
3. 记录变更理由。

## 完成标准
- 执行规范与代码行为一致。
