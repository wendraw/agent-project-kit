---
name: workspace-setup
description: Validate repo mappings and verify service context is loaded for all target repos.
---

# workspace-setup

## 目标
校验 repo 链接有效性，并确认所有目标仓库的服务上下文已加载到 `context/tech/services/`。

## 必要输入
- `requirements/repo-links.yml`
- `06-task-assignment.yaml`

## 执行清单
1. 校验前后端 repo 链接格式是否合法。
2. 校验任务与 repo 映射是否一致（`06-task-assignment.yaml` 中的 repo 必须在 `repo-links.yml` 中有对应条目）。
3. 检查 `context/tech/services/` 下是否存在每个仓库的服务上下文文件。
4. 若缺失服务上下文，输出警告并建议执行 `/load-service <repo-url>`。

## 完成标准
- 所有仓库映射无歧义。
- 所有仓库的服务上下文已加载（或显式标注为缺失并告警）。
