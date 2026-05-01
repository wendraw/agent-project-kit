---
name: requirement-completer
description: Run completion gate checks and transition requirement to completed state.
---

# requirement-completer

## 目标
将需求从 `validating` 推进到 `completed`。

## 必要输入
- `07-delivery.md`
- 经验沉淀记录

## 执行清单
1. 运行 gate：`agentkit req-dev --id <req-id> --transition validating:completed --check-only`。
2. 修复失败项后再次检查。
3. 通过后执行正式状态推进。

## 完成标准
- gate 通过。
- `requirements/INDEX.md` 状态正确。
