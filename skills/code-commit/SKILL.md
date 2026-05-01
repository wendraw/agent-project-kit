---
name: code-commit
description: Prepare structured commit and PR metadata with verification and risk notes.
---

# code-commit

## 目标
形成可审阅的提交与 PR 描述。

## 必要输入
- 任务 ID
- 变更摘要

## 执行清单
1. 生成结构化 commit message（含任务 ID）。
2. 生成 PR 描述：背景、改动点、验证结果、风险与回滚。
3. 回写 `07-delivery.md` 中 PR 链接。

## 完成标准
- PR 信息完整，评审可快速通过。
