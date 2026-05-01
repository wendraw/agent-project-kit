# RFC-0001: AgentKit 整体架构（Cursor 场景）

- 状态: Draft
- 作者: agentkit 团队
- 创建日期: 2026-02-26
- 适用版本: `@agentkit/cli` v0.1.x+

## 1. 背景

我们要解决的核心问题是:

1. 产品 PRD 与研发执行之间存在信息断层。
2. 前后端分仓协作下，上下文容易漂移。
3. 经验很难稳定沉淀为“下一次可复用规则”。

目标不是做“更复杂工具链”，而是做“更短入口 + 更稳复利闭环”。

## 2. 设计原则

1. 入口短小: 只保留两个主命令（`/req-dev`、`/optimize-flow`）。
2. 位置即语义: `requirements/` 只放需求产物，`context/` 只放可复用知识。
3. 复利沉淀: 每次执行除了完成当次任务，还要更新可复用规则与经验索引。
4. 分仓友好: 不依赖本地统一 `workspace/`，改用仓库链接与任务映射。

## 3. 架构分层

## 3.1 Command 层（固定 2 个）

1. `/req-dev`: 需求研发统一入口（创建/推进需求）。
2. `/optimize-flow`: 流程优化沉淀入口（规则与经验写回）。

## 3.2 Agent 层（目标态与落地态）

目标态（与文章架构一致）:

1. `phase-router`
2. `requirement-manager`
3. `design-manager`
4. `implementation-executor`
5. `experience-depositor`

落地态（V1，当前建议）:

1. `phase-router`
2. `delivery-manager`
3. `experience-depositor`

说明: V1 先降复杂度，避免 5 Agent 带来的维护开销；当并行需求规模上来再扩展到目标态。

## 3.3 Skill 层（目标态与落地态）

目标态（12 Skills）:

1. `req-create`
2. `req-change`
3. `experience-index`
4. `design-create`
5. `design-change`
6. `workspace-setup`
7. `design-implementation`
8. `code-commit`
9. `requirement-completer`
10. `requirement-archiver`
11. `meta-maintainer`
12. `index-manager`

落地态（V1，建议 6 Skills）:

1. `req-manage`
2. `design-manage`
3. `implementation`
4. `repo-link-resolve`
5. `experience-index`
6. `meta-maintainer`

说明: `workspace-setup` 在本场景下不作为核心能力（无统一 workspace）。

## 4. 目录结构（位置即语义）

```text
your-project/
├── AGENTS.md
├── agents/
├── skills/
├── workflow/
├── context/
│   ├── business/
│   ├── tech/
│   │   └── services/
│   ├── rules/
│   ├── experience/
│   └── index.json
└── requirements/
    ├── INDEX.md
    ├── repo-links.yml
    ├── in-progress/
    ├── completed/
    └── archive/
```

约束:

1. 不设置主结构 `workspace/`。
2. 若后续确实要本地拉仓，使用临时缓存目录（如 `workflow/cache/workspaces/`），且必须 git ignore。

## 5. 需求生命周期与标准产物

状态机:

`draft -> design -> implementing -> validating -> completed -> archived`

每个需求目录（`requirements/in-progress/<req-id>/`）标准产物:

1. `00-intake.md`
2. `01-test-cases.mmd`
3. `02-technical-solution.md`
4. `03-api-design.md`
5. `04-ui-handoff.md`
6. `05-task-breakdown.yaml`
7. `06-task-assignment.yaml`
8. `07-delivery.md`
9. `08-retro.md`

门禁要求:

1. 进入 `implementing` 前，`03-api-design.md` 与 `04-ui-handoff.md` 必须可用。
2. 进入 `completed` 前，`07-delivery.md` 必须包含前后端 PR 链接与验证结果。
3. 完成后必须执行一次 `/optimize-flow`。

## 6. 分仓协作模型

`requirements/repo-links.yml` 维护仓库映射:

1. `frontend: <repo-url>`
2. `backend: <repo-url>`

`06-task-assignment.yaml` 维护执行映射:

1. `task_id`
2. `repo`
3. `branch`
4. `assignee`
5. `input_docs`
6. `pr_link`（可在交付阶段补齐）

## 7. 两个命令的职责边界

## 7.1 `/req-dev`

职责:

1. 接收需求输入（标题/PRD链接/领域/仓库映射）。
2. 生成或推进需求产物。
3. 更新索引与状态。
4. 注入 context 检索结果。

## 7.2 `/optimize-flow`

职责:

1. 把交付经验提炼为规则（context/risk/service/pattern）。
2. 写入 `context/rules/*.md` 与 `context/experience/*.md`。
3. 重建 `context/index.json`。

## 8. 幂等、审计与恢复

1. 同一 `req-id` 重复执行默认增量更新，不覆盖人工内容。
2. 显式 `--force` 才覆盖自动块。
3. 关键文件写入 `updated_at`。
4. 命令失败需输出可执行修复建议，不输出敏感凭证。

## 9. 观测指标（评估是否升级到 5 Agent/12 Skills）

1. 需求包完整率（字段完整、门禁通过）。
2. 规则复用率（新需求引用历史规则的比例）。
3. 返工率（需求到交付过程中的重复修改次数）。
4. 单需求端到端交付时长。

建议阈值:

1. 并行需求 > 8/周 或
2. 规则条目 > 300 且冲突明显

满足阈值后进入“目标态 Agent/Skill 扩容”。

## 10. 子 RFC 规划

1. RFC-0002: `req-dev --prd-link` 飞书 PRD 自动拉取与全流程自动生成。
2. RFC-0003: 规则去重、评分与冲突治理。
3. RFC-0004: 需求状态门禁自动检查器。
