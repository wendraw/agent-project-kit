# AgentKit Skills

本目录用于存放 Agent 可复用执行能力（Skills）。

约定：
- 每个 skill 一个目录，入口文件固定为 `SKILL.md`。
- 每个 skill 推荐包含 `agents/openai.yaml` 作为 Agent UI 元信息。
- Skill 只描述“怎么做”，不存放业务事实。
- 业务事实统一放在 `requirements/` 与 `context/`。

使用顺序（推荐）：
1. 从 `INDEX.md` 选择 skill。
2. 打开对应 `SKILL.md` 按执行清单推进。
3. 产物写回需求包与 context。
