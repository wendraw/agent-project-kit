# RFC-0003: 规则去重、评分与冲突治理

- 状态: Draft
- 作者: agentkit 团队
- 创建日期: 2026-02-26
- 目标版本: `@agentkit/cli` v0.2.x
- 依赖 RFC: RFC-0001, RFC-0002

## 1. 背景

`/optimize-flow` 会持续把经验写入 `context/rules/*.md`。  
如果没有治理机制，规则库会很快出现:

1. 重复规则
2. 矛盾规则
3. 低质量规则（触发条件不清、行动建议不可执行）

这会直接降低检索质量，反过来影响 `/req-dev` 的可用性。

## 2. 目标与非目标

### 2.1 目标

1. 为规则建立统一元数据结构，支持质量评估。
2. 在写入阶段做去重和冲突检测。
3. 给每条规则计算可解释评分，并支持生命周期管理。
4. 保证规则库增长时仍可稳定检索。

### 2.2 非目标

1. 不在 V1 引入向量数据库或复杂 RAG 基础设施。
2. 不在 V1 做全自动语义合并（先做人机协同）。
3. 不替代业务评审机制。

## 3. 规则数据模型

每条规则必须包含:

1. `rule_id`
2. `type`（`context|risk|service|pattern`）
3. `domain`
4. `trigger`
5. `action`
6. `insight`
7. `source_requirement_id`
8. `source_artifact`
9. `status`（`draft|validated|deprecated|archived`）
10. `score`（0-100）
11. `confidence`（0-1）
12. `created_at`, `updated_at`
13. `supersedes` / `superseded_by`（可选）

## 4. 写入与治理流程

## 4.1 去重

`optimize-flow` 写入前执行:

1. 结构化归一化（小写、去噪、同义词映射）。
2. 精确去重（`type+domain+trigger+action` 完全一致）。
3. 近似去重（文本相似度阈值，建议 0.85）。

策略:

1. `exact` 命中: 不新建，更新 `updated_at` 和引用计数。
2. `near` 命中: 标记为 `review-needed`，由人工确认合并或保留。
3. 无命中: 新建规则。

## 4.2 冲突检测

冲突判定（V1）:

1. 同 `type+domain+trigger` 下，`action` 互斥。
2. 新规则与已 `validated` 规则产生相反建议。

冲突处理:

1. 新规则状态置为 `draft-conflicted`。
2. 输出冲突清单（列出冲突 rule_id）。
3. 不自动覆盖旧规则。

## 4.3 评分模型（V1）

建议评分（0-100）:

1. 基础分: 40
2. 来源质量（有真实 requirement + delivery 证据）: +20
3. 可执行性（trigger/action 明确）: +15
4. 复用信号（被命中使用）: +15
5. 时效性（近 90 天更新）: +10
6. 冲突或过期扣分: -30 ~ -10

`confidence` 初始可按 `0.5`，随验证和复用提升。

## 5. 生命周期管理

状态流转:

`draft -> validated -> deprecated -> archived`

规则:

1. `draft`：新写入，未验证。
2. `validated`：至少一次成功复用，且无冲突。
3. `deprecated`：存在更优替代规则（通过 `superseded_by` 指向）。
4. `archived`：长期不用且不建议继续检索。

## 6. 与命令的集成

保持“2 命令约束”，不新增主命令。

`/optimize-flow` 增加内部治理步骤:

1. normalize
2. dedup-check
3. conflict-check
4. score-calc
5. writeback
6. index-update

`/req-dev` 检索规则时优先级:

1. `validated` > `draft`
2. 高分优先
3. 近期更新优先

## 7. 索引扩展

`context/index.json` 增加字段:

1. `rule_type`
2. `score`
3. `confidence`
4. `status`
5. `conflict_with`（可选）

## 8. 验收标准

1. 重复规则写入率下降（目标 < 5%）。
2. 冲突规则能被显式标记并可追踪。
3. 检索时优先返回高质量规则。
4. 规则状态与评分可审计。

## 9. 实施计划

1. M1: 建立统一规则元数据结构与索引字段。
2. M2: 实现精确去重 + 冲突检测。
3. M3: 加入近似去重与评分模型。
4. M4: 在试运行中校准阈值（相似度/评分权重）。
