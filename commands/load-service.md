# load-service — 加载服务上下文（分析、沉淀到 context）

对目标服务做一次性深度分析，产出长期可复用上下文。

将命令后面的内容视为 `$ARGUMENTS`。

---

## 参数格式

```
/load-service <source> [--branch <branch>] [--name <service-name>]
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `<source>` | 本地路径 **或** repo URL | `/Users/me/code/web-app` 或 `https://git.example.com/venus/web-app` |
| `--branch` | 指定分支（仅 URL 模式有效） | `--branch feature/collab` |
| `--name` | 覆盖服务名称（默认取目录/仓库名） | `--name canvas-fe` |

**本地路径优先**：若 `<source>` 是本地路径（以 `/` 或 `./` 开头，或 `~` 开头），直接读取，不做任何 clone，节省 token 和时间。

---

## 执行

### 确定源目录

- **本地路径**：直接使用该路径，无需 clone。验证路径存在后跳到分析步骤。
  - 如果能从 git remote 或 `--name` 推断出 `repo_key`，同时把 `workspace_overrides[repo_key] = 本地绝对路径` 写入 `~/.agentkit/config.json`。
- **repo URL**：
  - 若 `workflow/cache/workspaces/loadservice/<service-name>/` 已存在且非空，执行 `git fetch && git checkout <branch>`（避免重复 clone）。
  - 否则执行 `git clone --depth 1 [--branch <branch>] <url> workflow/cache/workspaces/loadservice/<service-name>/`。

### 分析内容（通用维度）

- 服务定位、核心职责、技术栈
- 对外 API / 事件 / 数据模型
- 存储模型信号（数据库 / ORM / 生成代码 / JSON 配置落库）
- 已有关键业务链路与可复用服务（如发布、复制、审核、版本切换）
- 关键模块、依赖关系、部署与运维要点
- 常见坑点与排障建议

### 前端仓库额外分析维度

- 技术栈（框架、构建工具、包管理器）
- 路由结构与页面组织
- 组件库与设计系统
- 状态管理方案
- API 调用模式（封装层、拦截器、请求/响应类型定义）
- WebSocket / 实时通信基础设施
- 现有权限 / 鉴权机制
- 代码规范（ESLint / Prettier 配置、命名约定）

### 后端仓库额外分析维度

- 数据库访问方式（jOOQ / JPA / MyBatis / 自研 DAL）与 schema 组织
- 与核心业务域直接相关的关键表 / 聚合 / JSON 字段，而不只写“有数据库”
- 已有关键写链路 / 复制链路 / 发布链路 / 审核链路
- 可直接复用的 Domain Service / Manager / Validator / Assembler
- 强业务约束（只读副本、权限、版本切换、幂等、历史记录）以及这些约束落在哪些模块

> 如果目标仓库是后端，产出的 `context/tech/services/<service>.md` 不能只停留在技术栈和顶层目录；至少要把“关键表/实体”和“既有业务复用链路”写出来，否则 design 阶段会误判为白板实现。

### 写入与索引

1. 写入：`context/tech/services/<service-name>.md`（记录分析来源：本地路径或 URL + 分支）
2. 运行索引重建：`node scripts/build-index.mjs`
3. 若本次是本地路径模式并能识别目标 repo，同时更新 `~/.agentkit/config.json` 中的 workspace override

---

## 示例

```bash
# 本地路径（推荐，速度快）
/load-service ~/code/web-app --name canvas-fe
/load-service ~/code/main-web-app --name main-fe
/load-service ~/code/backend-service --name backend

# 指定分支（URL 模式）
/load-service https://git.example.com/venus/web-app --branch develop --name canvas-fe
```

---

## 输出

- 新增服务上下文文件路径
- 来源标注（路径/URL + 分支 + 分析时间）
- 可复用标签建议（domain/tags）
- 若是后端仓库，明确列出关键表/实体、关键复用链路、强约束落点
