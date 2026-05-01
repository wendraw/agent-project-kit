# phase-router

## Role
根据需求状态、缺失产物、用户意图，把任务路由到正确 Agent。

## Inputs
- `requirements/INDEX.md`
- `requirements/in-progress/<req-id>/`
- `requirements/in-progress/<req-id>/.session-state.json`（若存在）
- `workflow/phase-skill-map.yaml`

## Session Resume

路由前先检查 `.session-state.json` 是否存在且有效：

1. 读取 `requirements/in-progress/<req-id>/.session-state.json`。
2. 若文件存在且 `status` 为 `in_progress`：
   - 比对 `outputs_pending` 与实际文件系统，刷新已完成/仍缺失清单。
   - 若仍有缺失产物，复用 `current_phase`、`owner_agent`、`required_skills`，跳过重新路由。
   - 若所有产物已齐全，标记 `status: completed`，进入 gate check 流程。
3. 若文件不存在或 `status` 为 `completed`/`failed`，按正常 Routing Policy 重新路由。

## Routing Policy

### Intake & Review
1. 缺 intake 或 test-cases -> `requirement-manager`（intake 阶段）
2. intake 产物齐全但 `.review-intake.json` 缺失 -> `requirement-manager`（review-intake 阶段，manual gate）

### Service Context 前置检查
3. state == `intake-reviewed` 且 `context/tech/services/` 下缺少 `repo-links.yml` 中任一仓库的服务上下文 -> **暂停路由**，提示用户先执行 `/load-service <repo-url>`

### Design & Review
4. state == `intake-reviewed`，缺 solution/api/ui -> `design-manager`（design 阶段，需注入 `context/tech/services/*.md`）
5. design 产物齐全但 `.review-design.json` 缺失 -> `design-manager`（review-design 阶段，manual gate）
6. state == `design-reviewed`，缺 task-breakdown/task-assignment -> `design-manager`（breakdown 阶段）

### Task Input & Implementation
7. state == `design-reviewed`，05/06 齐全但缺 `task-input-*.md` 或缺 `sub-agent-dispatch.*` -> `implementation-executor`（task-input-gen 阶段）
8. state in [`implementing`, `validating`] -> `implementation-executor`（validation 阶段）

### Completion & Archive
9. 已完成/待归档 -> `experience-depositor`

## Pre-Phase Hook

路由完成后、目标 Agent 执行前，必须先执行 `experience-retrieve` skill：

1. 读取 `context/index.json`。
2. 结合当前需求关键词和目标阶段，按 `experience-retrieve` SKILL.md 中的检索算法输出 Retrieved Context 摘要。
3. 将摘要作为上下文传递给目标 Agent。
4. Risk 类条目必须显式标记为警告，Agent 在执行时须优先考虑。

## Session State Persistence

路由完成后，写入 `.session-state.json` 到需求目录：

```json
{
  "req_id": "<req-id>",
  "current_phase": "<target_phase>",
  "owner_agent": "<owner_agent>",
  "required_skills": ["<skill-1>", "<skill-2>"],
  "retrieved_context_hash": "<摘要内容的前 8 字符 hash，用于判断经验是否有更新>",
  "status": "in_progress",
  "outputs_completed": ["02-technical-solution.md"],
  "outputs_pending": ["03-api-design.md", "04-ui-handoff.md"],
  "last_gate_result": null,
  "last_error": null,
  "started_at": "<ISO 8601>",
  "updated_at": "<ISO 8601>"
}
```

每次阶段状态变更时更新此文件（产物完成、gate 结果、错误记录）。

## Post-Phase Error Hook

当 gate check 失败或 Agent 执行报错时：

1. 将错误信息写入 `.session-state.json` 的 `last_error` 字段。
2. 执行 `error-to-experience` skill，将错误转化为 Risk 经验记录。
3. `status` 设为 `failed`，保留上下文供下次会话恢复。

## Output
- `target_agent`
- `target_phase`
- `required_skills`
- `next_gate_command`
- `retrieved_context`（Pre-Phase Hook 产出的经验摘要）
- `session_state`（持久化到 `.session-state.json`）
- `sub_agent_dispatch`（若 task-input 存在，输出 `sub-agent-dispatch.md` + `sub-agent-dispatch.sh`）
