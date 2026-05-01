# Slash Commands / Workflows

本项目采用「Slash Command 入口 + CLI 确定性执行后端」模式。

## 单一源

- Commands（意图入口）：`commands/*.md`
- Skills（执行规范）：`skills/*/SKILL.md`
- Agents（路由合约）：`agents/*.md`

## 安装

```bash
# 推荐的一次性初始化入口
npm run init

# 若只想刷新项目级投影
npm run build
npm run install:tools

# 或按目标安装项目级投影
agentkit install --target claude --force
agentkit install --target cursor --force
agentkit install --target codex --force
agentkit install --target kiro --force
agentkit install --target trae --force
agentkit install --target windsurf --force
agentkit install --target opencode --force

# 或按目标安装全局主命令
agentkit install --scope global --target claude --force
agentkit install --scope global --target cursor --force
agentkit install --scope global --target codex --force
```

`npm run init` 会固定安装全局 `agentkit` 启动器并写入 `~/.agentkit/config.json`；如果当前是交互终端，还会让你选择要支持哪些 Agent，并对这些 Agent 同时安装 `req-dev`、`optimize-flow`、`load-service` 的全局入口，以及当前仓库的项目级工具投影。

## 目标目录

### Cursor

- 全局命令目录：`~/.cursor/commands/*.md`
- 命令目录：`.cursor/commands/*.md`
- 直接使用：`/req-dev`、`/optimize-flow`、`/init-project`、`/load-service`

### Claude Code

- 全局命令目录：`~/.claude/commands/*.md`
- 命令目录：`.claude/commands/*.md`
- 直接使用：`/req-dev`、`/optimize-flow`、`/init-project`、`/load-service`

### Codex

- 全局技能目录：`~/.codex/skills/*`
- 技能目录：`.agents/skills/*`
- 命令文档镜像：`.agents/commands/*.md`
- `agentkit install --target codex` 会额外生成 4 个「命令型 Skill」：
  - `.agents/skills/req-dev/`
  - `.agents/skills/optimize-flow/`
  - `.agents/skills/init-project/`
  - `.agents/skills/load-service/`
- 这些命令型 Skill 作为 Codex 的项目级命令入口，并代理到 canonical command 文档执行。
- `npm run init` / `agentkit install --scope global --target codex` 会把 `req-dev`、`optimize-flow`、`load-service` 安装到用户级 `~/.codex/skills/`，作为全局 Agent 入口。

### Kiro

- 技能目录：`.kiro/skills/*`
- 无独立命令目录，`agentkit install --target kiro` 会生成 4 个命令型 Skill 作为入口。

### Trae

- 技能目录：`.trae/skills/*`
- 无独立命令目录，`agentkit install --target trae` 会生成 4 个命令型 Skill 作为入口。

### Windsurf

- 工作流目录：`.windsurf/workflows/*.md`
- 使用 `/workflow-name` 执行对应 workflow。

### OpenCode

- 命令目录：`.opencode/commands/*.md`
- 技能目录：`.opencode/skills/*`

## 代码仓库接入方式

当你在 `agent-project-kit` 之外的代码仓库里工作时，不需要把本地路径写回 `requirements/repo-links.yml`。

首次进入某个代码仓库，执行：

```bash
# 在 agent-project-kit 仓库里执行一次
npm run init

# 之后进入任意代码仓库，直接在 Agent 中使用
/req-dev
```

这一步会：

- 在所选 Agent 的用户级目录安装全局主命令，使 `/req-dev` 等入口在任意项目中可用。
- 在 `~/.local/bin` 安装全局 `agentkit` 启动器。
- 在用户级 `~/.agentkit/config.json` 写入 `context_root`。
- 当首次在代码仓库里运行 `/req-dev` 时，自动登记 `repo_key -> workspace_path` 的本地 override。

如果 `repo_key` 不能从 git remote 自动推断，再显式补一次：

```bash
agentkit bind --repo-key <repo-key>
```

## 协作规则

- 仅维护 source of truth：`commands/*.md`、`skills/*/SKILL.md`、`agents/*.md`
- `.cursor/`、`.claude/`、`.agents/`、`.kiro/`、`.trae/`、`.windsurf/`、`.opencode/` 是 install 生成物，不手工编辑
- 每次 source of truth 有变更，执行：

```bash
npm run build
npm run install:tools
```

## 设计原则

- Commands：定义流程编排，不绑定具体 Agent 产品。
- CLI：负责确定性步骤（拉 PRD、状态门禁、索引更新、导出、并行子 Agent 分发脚本生成）。
- Skills：负责非确定性产出（测试脑图、方案、拆解、复盘沉淀）。
