# init-project — 冷启动初始化项目级 AI 工程结构

初始化并校验本项目的 AI 工程结构可用。

---

## 执行

1. 校验核心目录与入口是否存在：
   - `AGENTS.md`
   - `skills/INDEX.md`
   - `workflow/phase-skill-map.yaml`
   - `requirements/repo-links.yml`
2. 若缺失，自动补齐最小结构。
3. 运行一次健康检查：
   - `npx tsc -p cli/tsconfig.build.json`
   - `node ./cli/dist/cli.js help`
4. 安装命令到各工具目录：
   - `node ./cli/dist/cli.js install`
5. 输出下一步建议：
   - 先执行 `load-service <repo>`
   - 再执行 `req-dev <prd-link>`

## 输出

- 初始化结果清单
- 缺失项修复结果
