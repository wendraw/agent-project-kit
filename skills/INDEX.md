# Skills Index

## Requirement
- `req-create`：创建需求包与初始状态。
- `req-change`：处理需求变更并回写影响面。
- `test-case-design`：按功能模块分组生成可执行测试用例（前置条件/步骤/预期）。

## Design
- `design-create`：从 intake/test + 服务上下文产出技术方案。
- `design-change`：方案变更评估与同步。
- `backend-context-curation`：补齐后端 service context 深度，拆分 repo 总览与专题技术文档。

## Implementation
- `workspace-setup`：校验 repo 链接与服务上下文加载状态。
- `design-implementation` (task-input-prepare)：按仓库分组生成自包含的 Agent Task Input 包。
- `code-commit`：提交代码与 PR 说明。

> **注意**：本仓库（上下文仓库）在实现阶段的产出是 `task-input-{repo}.md`，实际编码在各代码仓库中由 Agent 独立执行。

## Flow
- `requirement-completer`：完成态检查与交付收口。
- `requirement-archiver`：归档需求包。

## Compounding
- `experience-retrieve`：检索已有经验，在每个阶段执行前提供 Retrieved Context。
- `experience-index`：提取经验并写入索引。
- `error-to-experience`：将 gate 失败和执行错误转化为 Risk 经验记录（免疫闭环）。
- `context-budget`：管理上下文注入的 token 预算，防止上下文腐蚀。
- `knowledge-evolution`：追踪经验命中频次，推荐 Doc→Skill→Command 升级。
- `meta-maintainer`：维护 AGENTS 与流程元信息。
- `index-manager`：维护 `requirements/INDEX.md` 与上下文索引。
