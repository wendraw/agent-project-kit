---
name: test-case-design
description: Generate executable test-case mindmaps grouped by feature module.
---

# test-case-design

## 目标
让 `01-test-cases.mmd` 稳定输出为“先按功能模块分组，再给出可直接执行用例”的结构，减少 review-intake 反复返工。

## 必要输入
- `requirements/in-progress/<req-id>/00-intake.md`
- PRD 中的优先级列表（P0/P1）与关键复杂能力说明

## 输出规范（强约束）
1. 顶层必须先按**功能模块**分组，不允许平铺混杂。
2. 每个模块下的每条用例必须包含：
   - `前置条件`
   - `操作步骤`
   - `预期结果`
3. 每条用例建议采用固定标签：`TC-xxx | 标题 | 优先级 | 类型`。
4. 对高复杂能力（如文本节点接入 LLM）必须增加专项回归组，覆盖：
   - 正向链路
   - 边界裁剪
   - 异常/降级
   - 并发冲突
   - 安全拦截
5. 生成 `01-test-cases.mmd` 后，必须同步导出：
   - `01-test-cases.feishu-outline.txt`

## 执行清单
1. 从 PRD 提取模块清单（优先 P0，再补 P1）。
2. 为每个模块至少生成 3 条可执行用例（正向/边界/异常）。
3. 若存在 LLM 或多模态能力，追加专项回归用例集（>=10 条）。
4. 用 `agentkit mindmap-export --format feishu` 校验导出可用性（或由 `req-dev` 自动导出）。

## 完成标准
- `01-test-cases.mmd` 为模块化 + 可执行结构。
- `.txt` 导出文件齐全且可直接粘贴飞书脑图。
- review-intake 可直接按“覆盖度 + 可执行性”评审。
