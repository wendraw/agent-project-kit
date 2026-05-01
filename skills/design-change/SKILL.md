---
name: design-change
description: Update technical solution after requirement changes and keep design docs consistent.
---

# design-change

## 目标
在需求变更后快速修订技术方案并保持一致性。

## 必要输入
- 最新 `00-intake.md`
- 当前 `02-technical-solution.md`

## 执行清单
1. 先判断变更影响落在哪个方案维度/模块；优先在对应章节内修订，而不是散落补丁。
2. 如果当前技术方案是平铺结构，但需求已经明显分成多个主维度，应顺手重排 `02-technical-solution.md` 的组织方式。
3. 更新方案中的受影响章节。
4. 同步更新 `03-api-design.md` 与 `04-ui-handoff.md` 的相关部分。
5. 在文档中记录变更原因与影响面。

## 方案表达修订规则

1. 关键流程优先改成流程图/时序图，不优先改成步骤 table。
2. 架构取舍、职责边界、兼容约束、模型字段等“横向比较”内容，优先保留为 table。
3. 规则说明、设计原则、补充约束等“非对比型信息”，优先改成编号列表或短段落。
4. 当用户明确要求“按功能模块/维度重排技术方案”时，应把结构性调整本身视为有效设计改进，而不是只补几句说明。

## 完成标准
- 方案/API/UI 三份文档一致。
- 任务拆解无悬空依赖。
- 技术方案的呈现方式与内容类型匹配：流程看图、对比看表、规则看列表。
