---
name: error-to-experience
description: Convert gate failures and execution errors into Risk experience records for future immunity.
---

# error-to-experience

## 目标
将 gate check 失败或 Agent 执行错误自动转化为 Risk 类型经验记录，形成"踩坑→记录→下次预警"的免疫闭环。

## 触发条件
- Gate check 返回 FAIL（含失败的 check IDs）。
- Agent 执行阶段遇到阻塞性错误（如缺失依赖、API 不兼容、产物校验不通过）。

## 必要输入
- 需求 ID
- 错误来源：`gate_failure` 或 `execution_error`
- 错误详情：
  - gate_failure：失败的 check IDs、`.gate-report.json` 内容
  - execution_error：错误描述、涉及的产物文件、Agent 名称

## 执行清单

1. **提取错误模式**：
   - 从错误详情中归纳出可复用的失败模式（如"task-breakdown 缺少 assignee 字段"）。
   - 确定 domain（从需求 intake 提取）和 tags（从错误类型推断）。

2. **生成经验记录**：
   - 写入 `context/records/experience/<timestamp>-risk-<slug>.md`。
   - 记录格式：

   ```markdown
   ---
   id: risk-<slug>
   type: risk
   domain: <domain>
   tags: [risk, <error-type>, <phase>]
   trigger: "<触发条件描述>"
   source_req: <req-id>
   created_at: <ISO 8601>
   ---

   # Risk: <错误模式标题>

   ## 现象
   <错误的具体表现>

   ## 根因
   <分析出的根本原因>

   ## 预防措施
   <下次应如何避免>
   ```

3. **更新索引**：
   - 运行 `agentkit optimize-flow --id <req-id> --type risk --insight "<错误模式摘要>" --trigger "<触发条件>"`。
   - 确认 `context/index.json` 已新增该 Risk 条目。

4. **更新 Session State**：
   - 将错误和新建的经验记录路径写入 `.session-state.json` 的 `last_error` 字段。

## 完成标准
- 新 Risk 经验记录已写入 `records/experience/` 目录。
- `index.json` 中可检索到该记录（tags 包含 `risk`）。
- 下次 `experience-retrieve` 执行时，该 Risk 条目会被优先标记为 `⚠ RISK` 警告。
