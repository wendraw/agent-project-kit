# agent-project-kit

简体中文 | [English](./README.md)

`agent-project-kit` 是一个面向 AI 辅助研发的“需求优先”工作流工具包。

它把需求、方案、API 契约、按仓库拆分的任务包、交付状态和可复用经验都沉淀成文件，让不同 Agent 和不同代码仓库可以围绕同一份上下文协作。

## 它解决什么问题

在多仓库、多 Agent 协作时，常见问题是：

- 需求信息散在聊天记录里，换一个 Agent 就丢上下文
- 技术方案、API 契约、测试点和实现任务没有统一 source of truth
- 前端、后端、桌面端等仓库并行开发时，任务边界不清晰
- 做完一次排障或踩坑后，经验没有沉淀到下一次需求里

`agent-project-kit` 的核心目标是：把需求研发流程从“对话驱动”变成“文件驱动”，让 Agent 读取稳定产物，而不是依赖临时聊天记忆。

## 核心能力

- 在 `requirements/in-progress/<req-id>/` 下创建结构化需求包
- 按状态机推进 intake、design、breakdown、task-input、validation、completion、archive
- 用 `03-api-design.yaml` 保存 OpenAPI 3.1 API 契约
- 生成可直接交给代码仓库 Agent 执行的 `task-input-{repo}.md`
- 在 `context/` 中沉淀规则、风险、模式、服务上下文和经验记录
- 支持把命令和 skills 安装到 Claude Code、Cursor、Codex、Kiro、Trae、Windsurf、OpenCode 等工具目录

## 快速开始

```bash
npm install
npm run typecheck
npm run build
npm run init
```

`npm run init` 会构建 CLI、安装本地 `agentkit` 启动器、写入 `~/.agentkit/config.json`，并按选择安装对应 Agent 工具入口。

## 常用命令

```bash
# 用文本创建一个需求
agentkit req-dev --task "新增团队空间账单能力"

# 用 PRD 链接创建需求
agentkit req-dev --prd-link "https://example.feishu.cn/docx/xxxx"

# 从本地代码仓库加载服务上下文
agentkit load-service ~/code/web-app --name frontend

# 导出 Mermaid 脑图为飞书友好的文本格式
agentkit mindmap-export --input requirements/in-progress/<req-id>/01-test-cases.mmd
```

## 目录结构

- `commands/`：用户入口命令
- `agents/`：阶段路由和角色契约
- `skills/`：可复用阶段执行清单
- `cli/`：TypeScript CLI 实现
- `workflow/`：流程路由和工作流配置
- `requirements/`：需求包、需求索引和仓库映射
- `context/`：规则、决策、模式、playbook、服务上下文和经验索引
- `docs/`：RFC 和命令文档

## 推荐工作流

1. 用 `agentkit req-dev --task "<需求描述>"` 创建需求包。
2. 补齐 `00-intake.md` 和 `01-test-cases.mmd`，完成需求澄清。
3. 进入设计阶段，维护 `02-technical-solution.md`、`03-api-design.yaml` 和 `04-ui-handoff.md`。
4. 进入拆解阶段，生成 `05-task-breakdown.yaml` 和 `06-task-assignment.yaml`。
5. 进入实现交接阶段，为每个目标仓库生成 `task-input-{repo}.md`。
6. 在各代码仓库中让 Agent 按任务包实现、验证并提交。
7. 回填 `07-delivery.md`，完成验证后归档到 `requirements/archive/`。

## 敏感信息规则

这个公开模板不包含真实需求包、服务上下文、业务记录、凭据或私有仓库链接。

本地密钥不要提交到 git：

```bash
cp workflow/secrets/feishu.env.example workflow/secrets/feishu.env
```

然后只在本地填写自己的配置。

如果你从内部仓库导出公开版本，建议先检查：

```bash
rg -n "secret|token|password|app_secret|private key|BEGIN .*PRIVATE KEY" .
git status --short
```

如果凭据曾经进入过内部仓库历史，公开前应创建无历史导出副本，并轮换相关凭据。

## 开发

```bash
npm run typecheck
npm run build
npm run build:index
```

`.claude/`、`.cursor/`、`.agents/`、`.kiro/`、`.trae/`、`.windsurf/`、`.opencode/` 等工具投影目录是生成物，不应手工维护，也不应提交到仓库。

## License

MIT
