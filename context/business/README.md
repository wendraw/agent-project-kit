# Business Context

`context/business/` 用于沉淀可跨需求复用的业务规则、边界条件与风险清单（例如：优惠券、虚拟商品、支付、风控）。

建议每条记录使用 frontmatter，便于 `scripts/build-index.mjs` 收录：

```md
---
id: biz-coupon-eligibility
title: Coupon eligibility rules
stage: business
domain: marketing
status: verified
owner: product-platform
tags: [business, coupon, risk]
updated_at: 2026-03-01T00:00:00Z
---
```

编写建议：

- 聚焦可复用规则，不写需求专属实施细节
- 把触发条件和排除条件写清楚
- 对高风险条目带上 `risk` tag，便于检索优先级提升
