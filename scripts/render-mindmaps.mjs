#!/usr/bin/env node
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function printHelp() {
  console.log(`Usage:
  node scripts/render-mindmaps.mjs [target] [--dry-run]

Arguments:
  target       File or directory to scan (default: requirements)

Options:
  --dry-run    Only print which .mmd files would be rendered
  -h, --help   Show this help message

Examples:
  pnpm mindmap:render
  pnpm mindmap:render requirements/in-progress/req-20260226-xxx
  pnpm mindmap:render:dry`);
}

function parseArgs(argv) {
  let dryRun = false;
  let target = "";

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (!target) {
      target = arg;
      continue;
    }
    console.error(`[mindmap] Unknown argument: ${arg}`);
    process.exit(1);
  }

  return { dryRun, target };
}

function collectMmdFiles(startPath) {
  const files = [];
  const stack = [startPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const stats = statSync(current);
    if (stats.isFile()) {
      if (extname(current).toLowerCase() === ".mmd") {
        files.push(current);
      }
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      stack.push(resolve(current, entry.name));
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function resolveBrowserPath() {
  const candidates = [
    process.env.AGENTKIT_CHROME_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || "";
}

function renderMindmap(inputFile) {
  const outputFile = `${inputFile.slice(0, -4)}.svg`;
  console.log(`[mindmap] rendering: ${inputFile} -> ${outputFile}`);
  const args = ["dlx", "@mermaid-js/mermaid-cli", "-i", inputFile, "-o", outputFile];
  let configFile = "";
  const mermaidConfigFile = resolve(process.cwd(), "scripts", "mermaid.config.json");
  if (existsSync(mermaidConfigFile)) {
    args.push("-c", mermaidConfigFile);
  }

  const browserPath = resolveBrowserPath();
  if (browserPath) {
    configFile = resolve(tmpdir(), `agentkit-mermaid-${process.pid}-${Date.now()}.json`);
    writeFileSync(
      configFile,
      `${JSON.stringify(
        {
          executablePath: browserPath,
          headless: "new",
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    args.push("-p", configFile);
  }

  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (configFile && existsSync(configFile)) {
    rmSync(configFile, { force: true });
  }
  return result.status === 0;
}

function main() {
  const { dryRun, target } = parseArgs(process.argv.slice(2));
  const startPath = resolve(process.cwd(), target || "requirements");

  if (!existsSync(startPath)) {
    console.error(`[mindmap] target not found: ${startPath}`);
    process.exit(1);
  }

  const files = collectMmdFiles(startPath);
  if (files.length === 0) {
    console.log(`[mindmap] no .mmd files found under: ${startPath}`);
    return;
  }

  if (dryRun) {
    console.log(`[mindmap] dry run: ${files.length} file(s)`);
    for (const file of files) {
      const outputFile = `${file.slice(0, -4)}.svg`;
      console.log(`[mindmap] would render: ${file} -> ${outputFile}`);
    }
    return;
  }

  let failed = 0;
  for (const file of files) {
    const ok = renderMindmap(file);
    if (!ok) {
      failed += 1;
      console.error(`[mindmap] failed: ${file}`);
    }
  }

  if (failed > 0) {
    console.error(`[mindmap] done with failures: ${failed}/${files.length}`);
    process.exit(1);
  }
  console.log(`[mindmap] rendered ${files.length} file(s) successfully.`);
}

main();
