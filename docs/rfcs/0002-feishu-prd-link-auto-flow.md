# RFC-0002: `req-dev --prd-link` 飞书 PRD 自动拉取与全流程自动生成

- 状态: Draft
- 作者: agentkit 团队
- 创建日期: 2026-02-26
- 目标版本: `@agentkit/cli` v0.1.x
- 依赖 RFC: RFC-0001

## 1. 背景

当前团队目标是:

- 使用 Cursor 而不是 CodeBuddy。
- 前后端分仓协作，不依赖本地统一 `workspace/`。
- 用两个命令完成闭环:
  - `/req-dev` 作为需求研发统一入口
  - `/optimize-flow` 作为经验复利沉淀入口

当前痛点是: 产品给出飞书 PRD 链接后，研发仍需手工复制内容到需求包，自动化断点出现在第一步。

## 2. 目标与非目标

### 2.1 目标

1. 支持 `agentkit req-dev --prd-link <feishu_url>` 直接拉取 PRD 内容。
2. 拉取完成后自动生成完整需求包（从 intake 到 retro），无需手工补“骨架文件”。
3. 保持“位置即语义”目录约束（`requirements/` vs `context/`）。
4. 对飞书 API 失败提供可恢复降级路径，不阻塞研发。

### 2.2 非目标

1. 不在本 RFC 内实现代码生成或自动提测。
2. 不在本 RFC 内实现飞书附件（图片、表格、嵌入对象）全量解析。
3. 不在本 RFC 内引入本地 `workspace/` 拉仓机制。

## 3. 总体方案

### 3.1 命令契约

`req-dev` 新增参数:

```bash
agentkit req-dev \
  --prd-link "https://xxx.feishu.cn/docx/..." \
  --frontend-repo "https://git.company/fe.git" \
  --backend-repo "https://git.company/be.git" \
  [--id <requirement-id>] \
  [--task <override-title>] \
  [--domain <domain>] \
  [--owner <owner>] \
  [--context-tags a,b]
```

行为定义:

1. 若提供 `--prd-link`:
   - 自动调用飞书 OpenAPI 拉取文档标题与正文。
   - 若未提供 `--task`，默认使用飞书文档标题作为需求标题。
2. 自动生成 `requirements/in-progress/<id>/` 下完整需求包文件。
3. 自动更新:
   - `requirements/INDEX.md`
   - `requirements/repo-links.yml`
4. 自动执行上下文检索并写入 `02-technical-solution.md` 的引用区块。

### 3.2 自动流程（无人工中断）

1. 用户执行 `req-dev --prd-link ...`
2. 系统解析链接并拉取 PRD
3. 生成需求 ID 与目录
4. 生成 9 个阶段文件（intake/test/solution/api/ui/task/delivery/retro）
5. 写入前后端仓库链接映射
6. 更新需求索引状态为 `in-progress`
7. 输出下一步提示（进入方案评审或任务拆解）

## 4. 飞书 OpenAPI 设计

## 4.1 凭证与配置

默认从环境变量读取:

- `AGENTKIT_FEISHU_APP_ID`
- `AGENTKIT_FEISHU_APP_SECRET`
- `AGENTKIT_FEISHU_BASE_URL`（可选，默认 `https://open.feishu.cn`）

安全要求:

1. 不把 `app_secret` 写入仓库文件。
2. 日志不打印完整 token/secret。
3. 失败信息仅输出必要错误码与诊断建议。

### 4.2 链接类型支持

首期支持:

1. `docx` 链接: `.../docx/<token>`
2. `wiki` 链接: `.../wiki/<token>`（先解析 wiki 节点再映射到 docx）

### 4.3 API 调用序列（拟定）

1. 获取租户访问令牌  
   `POST /open-apis/auth/v3/tenant_access_token/internal`
2. 若为 wiki 链接，解析节点对象  
   `GET /open-apis/wiki/v2/spaces/get_node?token=<wiki_token>`
3. 获取文档元信息（标题）  
   `GET /open-apis/docx/v1/documents/{document_id}`
4. 获取文档正文（raw content）  
   `GET /open-apis/docx/v1/documents/{document_id}/raw_content`

注: 实际字段名以飞书官方文档为准，开发时做字段兼容处理（例如 `content/raw_content` 双路径兜底）。

### 4.4 降级策略

当飞书拉取失败时:

1. `req-dev` 不直接崩溃退出，可通过 `--allow-empty-prd`（待实现）继续生成骨架。
2. 在 `00-intake.md` 中写入“拉取失败原因 + 待人工补录”区块。
3. CLI 给出明确修复动作（权限检查、链接类型、token 配置）。

## 5. 目录与产物约束

保留当前轻量结构（无 `workspace/`）:

```text
your-project/
├── AGENTS.md
├── agents/
├── skills/
├── workflow/
├── context/
└── requirements/
```

`requirements/in-progress/<req-id>/` 文件规范:

1. `00-intake.md`（必须包含 PRD 链接 + 自动拉取正文区块）
2. `01-test-cases.mmd`
3. `02-technical-solution.md`
4. `03-api-design.md`
5. `04-ui-handoff.md`
6. `05-task-breakdown.yaml`
7. `06-task-assignment.yaml`（必须含前后端 `repo/branch`）
8. `07-delivery.md`（必须含 PR 链接）
9. `08-retro.md`

## 6. 幂等与可恢复

1. 同一 `--id` 重复执行默认“增量更新，不覆盖人工内容”。
2. 通过 `--force` 显式覆盖自动生成区块。
3. 每次执行写入 `updated_at`，便于审计和冲突排查。
4. 网络中断时可重试，不应产生损坏文件。

## 7. 验收标准

满足以下条件视为 RFC 可进入实现:

1. 公开或有权限的飞书 docx/wikis 链接可被成功拉取。
2. 无 `--task` 时可从 PRD 标题自动命名需求。
3. 一条命令可完整产出需求包并更新索引与 repo 映射。
4. 失败时有可操作错误信息，不泄露密钥。
5. 在前后端分仓场景下，无需本地 `workspace/` 也能推进流程。

## 8. 备选方案比较

### A. 手工复制 PRD（现状）

- 优点: 零开发成本
- 缺点: 易漏信息，入口不统一，自动化断点明显

### B. 仅支持文件导入（`--prd-file`）

- 优点: 稳定，技术复杂度低
- 缺点: 仍需人工导出，不满足“链接即入口”

### C. 本 RFC（推荐）

- 优点: 入口最短，流程连贯，符合“执行一次让下一次更稳”
- 缺点: 需要处理飞书权限与接口兼容

## 9. 实施计划（通过后）

1. M1: 实现飞书拉取能力（docx/wiki + 错误处理）
2. M2: 接入 `req-dev --prd-link` 自动填充 `00-intake.md`
3. M3: 增加降级模式与集成测试（成功/失败/权限不足）
4. M4: 文档更新与团队试运行（2 周）

## 10. 待讨论问题

1. `req-dev` 失败默认是否中断，还是默认降级继续？
2. `--allow-empty-prd` 是否默认开启？
3. 自动提取 tags/domain 的规则是否在 V1 实现，还是先手工输入？
4. 需要支持的飞书文档类型是否只限 docx/wiki，是否纳入 sheets/base？
