---
name: req-change
description: Apply requirement changes and synchronize impact across requirement artifacts.
---

# req-change

## 目标
对既有需求进行变更，并标注受影响文档。

## 必要输入
- 需求 ID
- 变更说明（范围、优先级、上线计划）

## 执行清单
1. 在 `00-intake.md` 增加变更记录（时间、原因、决策人）。
2. 标注受影响文件：`01/02/03/04/05/06`。
3. 触发对应文档重生成或重写。
4. 必要时执行 gate 检查。

## 完成标准
- 变更前后差异可追溯。
- 任务拆解与分配同步更新。
