# agentkit CLI

`agentkit` 命令行工具（TypeScript 实现），面向 Cursor / Claude Code / Codex 场景。

## 开发

```bash
npm run typecheck
npm run build
node src/cli.ts help
```

## 核心命令

```bash
agentkit req-dev --task "优惠券发放改造" --frontend-repo https://git.company/fe.git --backend-repo https://git.company/be.git
agentkit req-dev
agentkit req-dev --interactive
agentkit bind
agentkit bind --repo-key backend --req-id req-20260301-demo
npm run init
agentkit req-dev --prd-link "https://company.feishu.cn/docx/ABCDEF..." --prd-extract-mode both --frontend-repo https://git.company/fe.git --backend-repo https://git.company/be.git
agentkit req-dev --id req-20260226-coupon --transition design:implementing --check-only
agentkit req-dev --task-id TASK-003
agentkit req-dev --id req-20260226-coupon --dispatch-subagents
agentkit optimize-flow --id req-20260226-coupon --type pattern --insight "先冻结接口再并行开发" --trigger "前后端双仓协作" --tags api,contract
agentkit mindmap-export --input requirements/in-progress/req-20260226-xxx/01-test-cases.mmd --format feishu
```

## 说明

- `req-dev`：初始化阶段会生成 `00-intake.md`、`01-test-cases.mmd`（可执行用例结构：前置条件/操作步骤/预期结果），并自动导出 `01-test-cases.feishu-outline.txt`，后续阶段产物按 phase 逐步生成，并检索 context。
- `req-dev`：默认是非交互、确定性执行；只有显式传 `--interactive` 时才走 CLI 问答。
- `req-dev --interactive`：显式强制进入交互模式（需 TTY）。
- `bind`：绑定上下文仓（支持全局 `~/.agentkit/config.json` + 本地 `.git/config`/`.agentkit/bind.local.json`），后续 `req-dev` 自动定位 context root。
- `bind`：在代码仓库里执行时，会把当前仓库登记为对应 `repo_key` 的用户本地 workspace override；这些映射只写入 `~/.agentkit/config.json`，不进入 `agent-project-kit` 仓库。
- `load-service`：当输入是本地仓库路径时，会尝试顺手登记该 repo 的 workspace override，供 context 仓 implementing 阶段直接复用。
- `npm run init`：推荐的一次性初始化入口，会 build CLI、安装全局 `agentkit` 启动器、把当前 context 仓路径写入 `~/.agentkit/config.json`，并在交互终端里让你选择要支持哪些 Agent；对这些 Agent，会同时安装 `req-dev`、`optimize-flow`、`load-service` 的全局入口，以及当前仓库的项目级 tool projections。
- `install --scope global --target <tool>`：底层全局安装命令，会把 `req-dev`、`optimize-flow`、`load-service` 安装到该 Agent 的用户级目录。
- `req-dev --context-budget`：按 `l0/l1/l2` 控制检索摘要预算；命中会自动写回 `context/index.json` 的 `hit_count` / `last_hit_at`。
- `req-dev --dispatch-subagents`：生成并行子 Agent 分发产物（`sub-agent-dispatch.md`、`sub-agent-dispatch.sh`），分发时优先读取用户本地 workspace override，而不是要求 `repo-links.yml` 写本地路径。
- `req-dev --prd-extract-mode`：`raw | rich | both`，默认 `both`；`both` 模式会额外写入 `00-intake.raw.md` 与 `00-intake.feishu.json`。
- `req-dev`：若未显式传入 Feishu 环境变量，会自动尝试加载 `workflow/secrets/feishu.env`（若存在）。
- `req-dev`：会在 `00-intake.md` 自动生成 `Board 关键结论摘要（供 Agent 执行）` 模板，并预填 `Feishu Board` 的上下文候选片段。
- `optimize-flow`：把经验沉淀到 rule 文件和 experience 记录，自动重建索引。
- `mindmap-export`：把 Mermaid mindmap (`.mmd`) 导出为飞书可粘贴的文本大纲（默认 `*.feishu-outline.txt`，标题独立一行 + 空行 + 层级节点）。

## 代码仓库首次接入

```bash
# 在 agent-project-kit 目录执行，只需一次
npm run init

# 之后进入任意代码仓库，直接在 Agent 中使用
/req-dev
```

如果 git remote 不能唯一推断 `repo_key`，再补一次：

```bash
agentkit bind --repo-key canvas-fe
```

## 安装

发布到 npm 仓库后：

```bash
npm install -g @agentkit/cli
agentkit help
```
