---
name: backend-context-curation
description: Curate backend service context for design work when load-service output is too shallow; inspect storage, legacy write chains, reusable services, and split facts between context/tech/services/*.md and context/tech/backend/*.md.
---

# backend-context-curation

## 目标
把后端 service context 从“技术栈摘要”补成可支撑设计的上下文，同时避免 `context/tech/services/backend.md` 膨胀成 schema dump。

## 何时使用

- `/load-service` 后的后端 service context 只有技术栈、目录和通用框架说明。
- 当前需求依赖现有表结构、复制链路、发布链路、审核链路或版本切换逻辑。
- design 阶段需要判断“复用现有能力”还是“新建模型/流程”，但现有 context 不足以支撑判断。

## 必要输入

- `context/tech/services/<repo>.md`
- 对应后端 repo 的本地工作区
- 当前 requirement 文档（如 `00-intake.md`、`01-test-cases.mmd`、`02-technical-solution.md`）
- `context/index.json`

## 执行清单

1. 读取目标后端的 service context，先判断它是否缺少以下关键信息：
   - 数据库存储方式与 schema 入口
   - 领域相关关键表 / 聚合 / JSON 字段
   - 已有写链路 / 复制链路 / 发布链路 / 审核链路
   - 可复用的 Manager / Domain Service / Validator / Assembler
   - 只读、副本、权限、版本切换、历史记录等强约束
2. 进入代码仓检索真实实现，优先核对：
   - ORM / DAL / jOOQ 生成物 / migration 入口
   - 关键表定义与 repository / mapper / service
   - 关键业务链路的编排入口（Manager / Service / Controller）
3. 提炼四类事实：
   - `关键表/实体`
   - `关键写链路`
   - `可复用服务`
   - `强约束`
4. 决定内容落点：
   - 放在 `context/tech/services/<repo>.md` 的内容：repo 级稳定事实、分层结构、通用 API/安全/存储约束、深度专题入口。
   - 放在 `context/tech/backend/<topic>.md` 的内容：某个业务域的表设计、旧链路、类/方法入口、字段语义、设计启示。
5. 更新文档时遵循：
   - `backend.md` 只保留总览和深链，不堆完整字段表或长流程细节。
   - 每个 topic 文档只聚焦一个后端主题，并写清“现状事实”和“设计启示”。
6. 新增或更新 `context/tech/backend/*.md` 后，执行 `node scripts/build-index.mjs`，确认新文档进入 `context/index.json`。

## Topic 文档约定

- 路径：`context/tech/backend/<topic>.md`
- frontmatter 必须显式包含：`id`、`title`、`stage: tech`、`domain`、`status`、`owner`、`tags`、`updated_at`
- 正文最少包含：
  - `Scope`
  - `Current Facts`
  - `Design Implications`
  - `Source Pointers`

## 完成标准

- `context/tech/services/backend.md` 能作为 repo 级导航使用，而不是专题事实堆栈。
- 至少一个后端专题被拆到 `context/tech/backend/*.md` 并可被 `context/index.json` 检索。
- design 阶段可以直接依据这些文档判断是否复用现有表和业务链路。
