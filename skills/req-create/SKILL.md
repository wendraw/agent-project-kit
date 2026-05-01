---
name: req-create
description: Create requirement packet and initialize draft state from task/prd input.
---

# req-create

## 目标
创建一个可执行的需求包，进入 `draft` 状态。

## 必要输入
- 需求标题或 `--prd-link`
- `requirements/repo-links.yml`

## 执行清单
1. 运行 `agentkit req-dev --task ...` 或 `agentkit req-dev --prd-link ...`。
2. 确认 `requirements/in-progress/<req-id>/` 标准 intake 产物已生成。
3. 检查 `requirements/INDEX.md` 中已有该需求，且状态为 `in-progress`。

## 完成标准
- `00-intake.md` 已可读，且来源信息完整。
- `01-test-cases.mmd` 已存在，且为可执行用例结构（每条用例包含「前置条件 / 操作步骤 / 预期结果」）。
- 已同步导出测试脑图文本：`01-test-cases.feishu-outline.txt`。
