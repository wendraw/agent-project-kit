# RFC-0004: 需求状态门禁自动检查器

- 状态: Draft
- 作者: agentkit 团队
- 创建日期: 2026-02-26
- 目标版本: `@agentkit/cli` v0.2.x
- 依赖 RFC: RFC-0001

## 1. 背景

当前需求包虽然有标准产物，但状态推进主要依赖人工自觉。  
这会导致:

1. 文件存在但内容不完整
2. 需求被提前推进到 `completed`
3. 复盘与规则沉淀被跳过

需要一个“自动门禁检查器”保证流程质量。

## 2. 目标与非目标

### 2.1 目标

1. 对需求状态流转做可执行校验。
2. 在状态推进前阻断不满足条件的变更。
3. 输出可读且可机读的检查结果。
4. 与当前 2 命令模型兼容，不引入复杂入口。

### 2.2 非目标

1. 不替代代码评审与 CI 测试体系。
2. 不检查业务正确性（只检查流程完整性和关键字段约束）。

## 3. 状态机与门禁定义

状态机:

`draft -> design -> implementing -> validating -> completed -> archived`

### 3.1 `draft -> design`

必须满足:

1. `00-intake.md` 存在
2. `00-intake.md` 包含来源信息（PRD link 或 ticket）
3. `01-test-cases.mmd` 存在

### 3.2 `design -> implementing`

必须满足:

1. `02-technical-solution.md` 存在
2. `03-api-design.md` 存在
3. `04-ui-handoff.md` 存在（若含前端任务）
4. `05-task-breakdown.yaml` 有至少 1 条任务
5. `06-task-assignment.yaml` 包含 repo/assignee/input_docs

### 3.3 `implementing -> validating`

必须满足:

1. `07-delivery.md` 存在
2. `07-delivery.md` 至少包含一个 PR 链接
3. 验证区块包含 unit/integration/regression 项

### 3.4 `validating -> completed`

必须满足:

1. 验证结果已填写（非 TODO）
2. 交付文档包含 rollback 说明
3. 已执行一次 `/optimize-flow`（可通过写回记录检测）

### 3.5 `completed -> archived`

必须满足:

1. 需求目录完整
2. 索引状态已更新为 `completed`
3. 归档操作有时间戳

## 4. 检查器设计

## 4.1 集成方式

不新增主命令，采用 `req-dev` 子流程:

1. `agentkit req-dev --id <req-id> --transition <from>:<to>`
2. `agentkit req-dev --id <req-id> --check-only`

## 4.2 输出格式

每次检查输出:

1. 控制台摘要（PASS/FAIL + 缺失项）
2. 机读报告 `requirements/in-progress/<id>/.gate-report.json`

报告字段:

1. `requirement_id`
2. `from_state`, `to_state`
3. `passed`
4. `failed_checks`
5. `generated_at`

## 4.3 阻断策略

默认策略:

1. 门禁失败时禁止状态推进，返回非 0 退出码。

应急策略:

1. 允许 `--override-with-reason "<text>"`，强制推进并写审计日志。
2. 强制推进只能由特定角色执行（后续接权限系统）。

## 5. 索引与审计

`requirements/INDEX.md` 每条需求增加:

1. `state`
2. `last_gate_check`
3. `last_gate_result`

可选机读索引:

1. `requirements/index.json`（后续可加）

## 6. 验收标准

1. 非法状态流转可被阻断。
2. 缺失关键文档时给出明确缺失项。
3. 覆盖 5 条状态迁移检查。
4. 检查结果可追踪（报告文件 + 索引记录）。

## 7. 实施计划

1. M1: 实现检查规则与报告输出。
2. M2: 接入 `req-dev` 的 `--check-only` / `--transition`。
3. M3: 接入 `--override-with-reason` 审计能力。
4. M4: 团队试运行并收敛规则。
