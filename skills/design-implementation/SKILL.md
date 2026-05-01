---
name: design-implementation
description: Generate self-contained Agent Task Input packages per repo from technical solution and task assignment.
---

# design-implementation (task-input-prepare)

> 概念名称 `task-input-prepare`，文件名保持 `design-implementation` 以兼容已有引用。

## 目标
按仓库分组生成自包含的 Agent Task Input 包，供各代码仓库 Agent 独立执行实现。

## 必要输入
- `02-technical-solution.md`
- `03-api-design.yaml`（OpenAPI 3.1，接口定义 source of truth）
- `04-ui-handoff.md`
- `05-task-breakdown.yaml`
- `06-task-assignment.yaml`
- `requirements/repo-links.yml`
- `context/tech/services/{repo}.md`（各仓库的服务上下文）

## 执行清单
1. 读取任务分配（06），先判断需求是否天然分成多个主维度（例如按功能模块、业务链路或仓库协作边界）。
2. 对每个仓库：
   a. 读取对应的服务上下文（`context/tech/services/{repo}.md`）。
   b. 先按“维度/模块”而不是按文档来源整理该仓库任务；如果同一仓库同时承接模板、文本节点、组合运行等多条主线，`task-input-{repo}.md` 应按维度分节，而不是合成一份平铺清单。
   c. 从技术方案（02）、接口设计 YAML（03）、UI 交接（04）中提取与该仓库相关的内容。对后端仓库，从 OpenAPI YAML 中提取相关 paths 和 schemas；对前端仓库，提取相关 endpoint 调用签名和 response types。
   d. 对前端仓库，如果 `04-ui-handoff.md` 提供了 Figma file / node link 或 repo-specific design skill，必须把这些 design inputs 一并写进 task-input，便于实现仓直接通过 Figma MCP 获取设计上下文；如果 handoff 里有模块级节点映射表，task-input 也必须保留该映射，至少包含 `Exact Node Link`、`Fallback Spec Node` 和 `Status`。
   e. 生成 `task-input-{repo}.md`，格式遵循 `context/playbooks/playbook-agent-task-input.md`。
3. 确保每个 task-input 文件自包含：Objective、Constraints、Inputs、Deliverables。
4. 初始化或更新 `07-delivery.md`，为每个仓库创建 PR 跟踪条目。

## task-input 组织规则

1. 如果技术方案已经按多个主维度组织，task-input 应继承同样的维度划分，不要退化成单层实现 checklist。
2. 每个仓库的 task-input 可以保留一段公共约束，但具体改动项应按维度/模块拆分，例如“模板能力”“文本节点接入 LLM”“组合运行节点”。
3. 每个维度章节至少应说明四件事：该仓库在此维度的目标、需改动的接口/数据结构/页面交互、实现约束、验证要点。
4. 不要把来自 `02/03/04` 的信息机械地按来源罗列；应先归并为可执行实现项，再写入 task-input。
5. 对后端仓库，优先按”接口/领域模型/持久化/外部集成/测试”组织每个维度的实现项；对前端仓库，优先按”页面入口/交互状态/API 对接/异常处理/测试”组织。
6. **API 契约与数据库结构映射**：当 API 请求/响应的数据结构（如嵌套对象 `localConfig: { apiJSON, inputBindings, ... }`）与数据库表结构（如平铺列 `local_api_json`, `local_input_bindings`）不同时，task-input 中必须明确说明映射关系和实现方式（如：需要一个 DTO wrapper 类将嵌套结构拆解为平铺字段再写入数据库，反之从数据库读取时组装为嵌套结构返回）。不能假设域模型可以同时满足 API 契约和数据库映射。

## 输出格式

每个 `task-input-{repo}.md` 包含：
- **Objective**：本仓库需要完成的目标。
- **Constraints**：现有代码架构要点、技术栈约束、接口兼容性要求。
- **Inputs**：引用的技术方案片段、接口定义、UI 设计要求。
- 前端 repo 的 Inputs 如果存在 Figma 设计稿，应包含对应 file URL、node link、适用 design skill。
- 如果 `04-ui-handoff.md` 已维护模块级节点映射表，task-input 应按原样透传该表，避免实现仓回头重新定位 Figma 节点。
- **Deliverables**：交付物清单与验证命令。

## 完成标准
- 每个 `repo-links.yml` 中有任务分配的仓库，都有对应的 `task-input-{repo}.md`。
- 代码仓库 Agent 仅凭 task-input 文件即可完成实现，无需访问本仓库。
- `07-delivery.md` 已初始化所有仓库的跟踪条目。
- task-input 的组织方式与技术方案一致：跨维度内容按模块拆分，不混写成平铺任务单。
