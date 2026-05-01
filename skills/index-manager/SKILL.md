---
name: index-manager
description: Maintain requirements and context indexes for accurate retrieval and tracking.
---

# index-manager

## 目标
维护需求索引与 context 索引的一致性。

## 必要输入
- `requirements/INDEX.md`
- `context/index.json`

## 执行清单
1. 校验需求状态、门禁结果、更新时间。
2. 执行 context 索引重建。
3. 检查新增记录是否可检索。
4. 维护 `hit_count`/`last_hit_at` 字段完整性（由 `experience-retrieve` 写入，索引重建时保留）。
5. 保留 `evolution_candidate` 标记（由 `knowledge-evolution` 写入）。

## 完成标准
- 两类索引都可用且信息最新。
- `hit_count` 数据在索引重建后不丢失。
