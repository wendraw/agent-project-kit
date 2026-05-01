# optimize-flow — 经验沉淀入口（规则 + 经验记录 + 索引）

把当前需求中的可复用经验写回 context，形成复利。

将命令后面的内容视为 `$ARGUMENTS`，建议输入：`<req-id> <insight>`。

---

## 执行

1. 若 `$ARGUMENTS` 包含 req-id：直接调用
   - `node ./cli/dist/cli.js optimize-flow --id <req-id> --insight "<insight>"`
2. 若参数不完整：先从 `07-delivery.md` / `08-retro.md` 提炼 1~3 条 insight，再调用命令。
3. 确认 `context/records/experience/` 新增记录并已入索引。

## 输出

- 新增 rule/experience 路径
- 下次任务可直接复用的触发条件
