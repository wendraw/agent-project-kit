---
name: design-create
description: Generate technical solution from intake and test mindmap artifacts.
---

# design-create

## 目标
从 PRD + 测试脑图产出技术方案文档。

## 必要输入
- `00-intake.md`
- `01-test-cases.mmd`
- `context/tech/services/*.md`（相关仓库的服务上下文，由 `/load-service` 产出）

## 执行清单
1. 读取相关仓库的服务上下文（`context/tech/services/*.md`），理解现有代码架构、技术栈、接口规范。
   - 如果后端 service context 仍只有技术栈/目录摘要，缺少关键表、旧链路或可复用服务，先使用 `$backend-context-curation` 补齐 `context/tech/backend/*.md`，再继续出方案。
2. 基于现有代码架构设计技术方案，确保接口、模型、技术选型兼容现有系统。
3. 先判断需求是否天然分成多个主维度（例如按功能模块、业务链路或仓库协作边界）；如果可以分维度，`02-technical-solution.md` 优先按 `Part 1 / Part 2 / Part 3` 组织，而不是平铺成一大段总流程。
4. 生成 `02-technical-solution.md`。
5. 补齐架构、权衡、风险与回滚方案。
6. 生成 `03-api-design.yaml`（OpenAPI 3.1 格式，作为接口设计的 source of truth）。
7. 生成 `04-ui-handoff.md` 时，如果涉及前端界面并且已有 Figma 设计稿，必须写出 repo 级 file 链接和可直接用于 Figma MCP 的 node link；若一个需求包含多个页面/弹窗/工作台模块，应额外维护模块级节点映射表，记录 `Exact Node Link`、`Fallback Spec Node` 和 `Status`。若有 repo-specific design skill，也应一并标注。
8. 从 `03-api-design.yaml` 自动生成 `03-api-design.md`（人可读摘要，用于评审）。
9. 对齐上下文引用（Retrieved Context）。

## 技术方案表达规范（02-technical-solution）

### 文档组织

1. 若需求明显包含多条主线，优先按“维度/模块”分章节，每个章节标题应直接体现主题；必要时在标题中标明涉及仓库。
2. 每个维度章节至少回答四件事：覆盖范围、涉及仓库职责、关键流程、关键数据/模型。
3. 不要把模板、文本节点、组合运行这类不同问题混写在同一组“总流程/总规则”里，除非它们在实现上确实不可分。

### 呈现方式

1. **用 table 的场景**：横向对比、职责边界、兼容约束、架构取舍、领域模型字段、风险/回滚对照、任务归属。
2. **用流程图/时序图的场景**：关键流程、端到端交互、跨系统协作、状态推进。关键流程默认优先用 Mermaid 表达，不优先用步骤表。
3. **用编号列表或短段落的场景**：规则说明、设计原则、补充约束、非对比型结论。
4. 不要让文档几乎全部由 table 组成；如果一段内容核心是“顺序”和“流转”，应优先改成图。

## API 设计规范（03-api-design）

- **Source of truth**：`03-api-design.yaml`，OpenAPI 3.1 规范。
- YAML 中的 `components/schemas` 应与 `02-technical-solution.md` 的 Domain Model 对齐。
- WebSocket 事件使用 `x-ws-events` 扩展字段描述。
- 修改接口时需标注 breaking change（通过 `x-breaking` 扩展字段）。

### 可读文档要求（03-api-design.md）

`03-api-design.md` 从 YAML 生成，必须**足够信息让开发者直接实现接口**，不能只有接口总览表。每个接口必须包含：

1. **完整的请求 JSON 示例**：包含所有字段的真实值，体现数据结构嵌套关系
2. **完整的响应 JSON 示例**：包含成功响应的完整数据结构
3. **字段说明表格**：每个字段的类型、是否必填、含义说明
4. **错误码表格**：该接口可能返回的所有业务错误码及说明
5. **业务规则**：校验逻辑、状态流转规则、自动计算逻辑、权限要求等
6. **变更说明**（修改现有接口时）：明确标注新增/修改/删除的字段及影响

## 完成标准
- 方案可支撑接口设计与任务拆解。
- 风险与边界清晰。
- 技术选型与现有代码架构兼容（不引入冲突的框架、模式或依赖）。
- `03-api-design.yaml` 通过 OpenAPI 3.1 schema 校验。
- 技术方案按需求维度组织，关键流程用图、对比项用表、规则项不用堆 table。
