#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const ASSETS_DIR = join(ROOT, "context");
const OUTPUT_FILE = join(ASSETS_DIR, "index.json");

function loadExistingIndex(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.filter((item) => item && typeof item === "object");
  } catch {
    return [];
  }
}

function walkFiles(dir) {
  const result = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(fullPath);
    }
  }
  return result;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { attrs: {}, body: content };
  }

  const attrs = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    attrs[key] = raw;
  }
  const body = content.slice(match[0].length);
  return { attrs, body };
}

function parseTags(raw) {
  if (!raw) {
    return [];
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""))
      .filter(Boolean)
      .map((item) => item.toLowerCase());
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function inferStage(relPath) {
  const parts = relPath.split("/");
  if (parts.length >= 3 && parts[0] === "context" && parts[1] === "records") {
    return parts[2];
  }
  if (parts.length >= 2 && parts[0] === "context") {
    return parts[1];
  }
  return "unknown";
}

function inferTitle(body, fallback) {
  const line = body.split(/\r?\n/).find((item) => item.trim().startsWith("# "));
  if (line) {
    return line.trim().replace(/^#\s+/, "");
  }
  return fallback;
}

const files = walkFiles(ASSETS_DIR).filter((file) => {
  if (file.endsWith("index.json")) {
    return false;
  }
  if (file.endsWith("/README.md")) {
    return false;
  }
  return true;
});
const existingEntries = loadExistingIndex(OUTPUT_FILE);
const existingByPath = new Map(existingEntries.map((entry) => [entry.path, entry]));
const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
const entries = files.map((filePath) => {
  const relPath = relative(ROOT, filePath).replace(/\\/g, "/");
  const content = readFileSync(filePath, "utf8");
  const { attrs, body } = parseFrontmatter(content);
  const stage = attrs.stage || inferStage(relPath);
  const title = attrs.title || inferTitle(body, relPath.split("/").pop() || relPath);
  const id = attrs.id || relPath.replace(/^context\//, "").replace(/\.md$/, "").replace(/\//g, "-");
  const domain = attrs.domain || "general";
  const status = attrs.status || "draft";
  const owner = attrs.owner || "unknown";
  const tags = parseTags(attrs.tags || "");
  const source = attrs.source || relPath;
  const flowId = attrs.flow_id || "N/A";
  const mtime = statSync(filePath).mtime.toISOString();
  const previous = existingByPath.get(relPath) || existingById.get(id) || {};
  const previousHitCountRaw = previous.hit_count;
  const hitCount =
    typeof previousHitCountRaw === "number" && Number.isFinite(previousHitCountRaw)
      ? Math.max(0, Math.floor(previousHitCountRaw))
      : 0;
  const lastHitAt = typeof previous.last_hit_at === "string" ? previous.last_hit_at : "";
  const evolutionCandidate = previous.evolution_candidate;

  const result = {
    id,
    title,
    stage,
    domain,
    status,
    owner,
    tags,
    path: relPath,
    source,
    flow_id: flowId,
    updatedAt: attrs.updated_at || mtime,
  };
  if (hitCount > 0) {
    result.hit_count = hitCount;
  }
  if (lastHitAt) {
    result.last_hit_at = lastHitAt;
  }
  if (evolutionCandidate !== undefined) {
    result.evolution_candidate = evolutionCandidate;
  }
  return result;
});

entries.sort((a, b) => a.path.localeCompare(b.path));

const output = {
  generated_at: new Date().toISOString(),
  entries,
};

writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[context] indexed ${entries.length} assets -> ${relative(ROOT, OUTPUT_FILE)}`);
