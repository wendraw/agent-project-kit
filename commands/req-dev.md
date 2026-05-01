# req-dev — 需求研发统一入口

`req-dev` 是 Agent 主入口，不是让用户手工走一长串 `agentkit` CLI 命令。

工作原则：

- Agent 负责对话、确认、补充上下文。
- `agentkit` CLI 负责确定性动作：定位 context root、查询 requirement / task、生成文件、跑 gate check、生成 dispatch 产物。
- 开发人员的日常入口是在本地代码仓库里直接使用 `/req-dev`。

将命令后面的内容视为 `$ARGUMENTS`。

---

## Step 0: 先定位 `agent-project-kit`

### 如果当前就在 `agent-project-kit` 仓库

直接使用当前仓库作为 context root。

### 如果当前在代码仓库

1. 先读取 `~/.agentkit/config.json`
2. 取出 `context_root`
3. 打开 `<context_root>/commands/req-dev.md` 继续执行本流程

如果 `~/.agentkit/config.json` 不存在、或 `context_root` 为空：

- 告诉用户先在本地 `agent-project-kit` 仓库执行：

```bash
npm install
npm run init
```

不要继续执行后续步骤。

---

## Step 1: 识别当前模式

### 模式 A：代码仓库开发模式

适用场景：

- 当前在 `web-app` / `backend-service` / `main-web-app` / `agent-service` 等代码仓库
- 用户输入 `/req-dev`
- 用户输入 `/req-dev <req-id>`
- 用户输入 `/req-dev <task-id>`

### 模式 B：context 仓需求推进模式

适用场景：

- 当前在 `agent-project-kit`
- 用户要创建新需求
- 用户要推进 design / review / breakdown / task-input / validation / completion
- 用户要执行 gate check / review writeback / dispatch-subagents

---

## Step 2A: 代码仓库开发模式

### 2A.1 识别当前 repo

1. 通过当前 git remote 对照 `requirements/repo-links.yml`
2. 推断当前 `repo_key`
3. 若能识别，自动把 `workspace_overrides[repo_key] = 当前仓库绝对路径` 写回 `~/.agentkit/config.json`
4. 若不能识别，提示用户运行：

```bash
agentkit bind --repo-key <repo-key>
```

### 2A.2 参数解析

#### 若用户输入了 `req-id`

1. 从 `requirements/in-progress/<req-id>/` 读取该需求
2. 读取 `06-task-assignment.yaml`
3. 只保留当前 `repo_key` 对应的任务

结果处理：

- 只有 1 个任务：向用户展示任务摘要，并确认是否开始实现
- 多个任务：列出任务，让用户选择
- 没有任务：明确提示“当前需求在本 repo 没有待实现任务”

#### 若用户输入了 `task-id`

1. 在所有 `in-progress` requirement 中检索该 `task-id`
2. 若当前在代码仓库，优先只看当前 `repo_key` 对应任务

结果处理：

- 唯一匹配：展示任务摘要，并确认是否开始实现
- 多个 requirement 命中：先让用户确认 requirement
- 没有命中：明确提示

#### 若用户没有输入任何参数

1. 在所有 `in-progress` requirement 中读取 `06-task-assignment.yaml`
2. 只保留当前 `repo_key` 对应任务

结果处理：

- 只有 1 个候选任务：展示任务摘要，并确认是否开始实现
- 多个候选任务：列出候选，让用户选择
- 没有候选任务：明确提示“当前 repo 没有进行中的任务”

### 2A.3 开始实现前必须展示的信息

在向用户确认前，至少展示：

- `requirement_id`
- `task_id`
- 任务标题
- 当前 repo
- 推荐 branch
- `input_docs`
- `context_query`
- 若已存在，对应的 `task-input-{repo}.md`

### 2A.4 用户确认后

确认开始实现后，Agent 在当前代码仓库中继续工作：

1. 打开该任务关联的 `task-input-{repo}.md`（若存在）
2. 打开必要的 `02/03/04/05/06` 产物
3. 在当前代码仓库中完成实现、测试、提交 PR
4. 如需要，再回到 `agent-project-kit` 更新 `07-delivery.md`

注意：

- 在代码仓库模式下，`req-dev` 的主要作用是“定位正确需求 / 任务并加载上下文”
- 不要把代码仓库模式误当成 context 仓的 requirement 生产流程

---

## Step 2B: context 仓需求推进模式

### 2B.1 创建或继续需求

#### 若用户输入飞书 PRD 链接

执行：

```bash
agentkit req-dev --prd-link "<url>" --prd-extract-mode both
```

#### 若用户输入自然语言需求

执行：

```bash
agentkit req-dev --task "<text>"
```

#### 若用户只输入 `/req-dev`

1. 读取 `requirements/in-progress/`
2. 若只有一个进行中需求，默认继续它
3. 若有多个进行中需求，先问用户继续哪个
4. 若没有进行中需求，再问用户输入需求描述或 PRD 链接

### 2B.2 路由规则

按 `workflow/phase-skill-map.yaml` 路由，主流程为：

1. `draft`
2. `review-intake`
3. `intake-reviewed -> design`
4. `review-design`
5. `design-reviewed -> breakdown`
6. `task-input-gen -> implementing`
7. `validating`
8. `completed`
9. `archived`

两个 review gate 不能跳过：

- `review-intake`
- `review-design`

### 2B.3 design 前置条件

进入 design 前必须检查：

- `requirements/repo-links.yml`
- `context/tech/services/*.md`

只要任一 repo 缺服务上下文，就暂停并提示用户先执行 `/load-service`。

### 2B.4 implementing 前必须生成的产物

进入 implementing 前，这个仓库必须生成：

- `task-input-{repo}.md`
- `sub-agent-dispatch.md`
- `sub-agent-dispatch.sh`
- `07-delivery.md`

同时必须检查：

- `06-task-assignment.yaml` 中涉及的每个目标 repo，都已经在 `~/.agentkit/config.json.workspace_overrides` 中有本地绝对路径

如果缺失：

- 暂停 implementing
- 提示用户先用本地路径执行 `/load-service <absolute-path> --name <repo-key>`，或在对应代码仓库里先跑一次 `/req-dev`

### 2B.5 validation / completion

在 context 仓中继续负责：

- `--transition ... --check-only`
- review writeback
- delivery 跟踪
- experience writeback

---

## Step 3: CLI 使用约束

当需要调用 CLI 时，遵循：

- 默认使用非交互 CLI
- 只在确有必要时显式使用 `--interactive`
- requirement / task 查询、gate check、dispatch 由 CLI 负责
- 用户确认和选择由 Agent 负责

常用 deterministic 命令：

```bash
agentkit req-dev --id <req-id> --transition <from:to> --check-only
agentkit req-dev --id <req-id> --dispatch-subagents
agentkit req-dev --id <req-id> --review <intake|design> --approved true --reviewer "<name>" --notes "<notes>"
```

---

## Output

根据模式不同，输出应满足：

### 代码仓库开发模式

- 当前 repo 识别结果
- requirement / task 候选
- 需要用户确认的实现对象
- 对应 `task-input` / `input_docs` / branch 建议

### context 仓需求推进模式

- 当前 requirement 的路由阶段
- 已生成 / 待补充文件
- 下一步建议
- 必要时的 gate check 命令
