#!/usr/bin/env node
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  checkbox as promptCheckbox,
  confirm as promptConfirm,
  input as promptInput,
  select as promptSelect,
} from "@inquirer/prompts";

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

type ContextIndexEntry = {
  id: string;
  title: string;
  stage: string;
  domain: string;
  tags: string[];
  status: string;
  owner?: string;
  flow_id?: string;
  path: string;
  source?: string;
  updatedAt?: string;
  hit_count?: number;
  last_hit_at?: string;
  evolution_candidate?: unknown;
};

type ContextIndexFile = {
  generated_at?: string;
  entries: ContextIndexEntry[];
};

type ContextQuery = {
  stage?: string;
  domain?: string;
  tags: string[];
  limit: number;
  budgetLevel: ContextBudgetLevel;
  maxTokens: number;
};

type ContextBudgetLevel = "l0" | "l1" | "l2";

type ContextSelectionResult = {
  selected: ContextIndexEntry[];
  matched_total: number;
  dropped_by_limit: number;
  dropped_by_budget: number;
  estimated_tokens: number;
};

type LocalBindConfig = {
  context_root?: string;
  repo_key?: string;
  active_requirement_id?: string;
  updated_at?: string;
};

type WorkspaceOverrideMap = Record<string, string>;

type GlobalBindConfig = {
  context_root?: string;
  workspace_overrides?: WorkspaceOverrideMap;
  updated_at?: string;
};

type FlowStageKey =
  | "prd-source"
  | "test-mindmap"
  | "technical-solution"
  | "api-design"
  | "ui-handoff"
  | "task-breakdown"
  | "task-assignment"
  | "delivery"
  | "retro";

type FlowStageGuide = {
  key: FlowStageKey;
  label: string;
  fileName: string;
  contextStage: string;
  inputs: string[];
  deliverables: string[];
};

type RepoLinks = Record<string, string>;

type FeishuPrdSource = {
  title: string;
  content: string;
  rawContent: string;
  richContent: string;
  richAvailable: boolean;
  sourceLink: string;
  documentToken: string;
  extractMode: FeishuExtractMode;
  sourcePayload: Record<string, unknown>;
};

type FeishuLinkToken = {
  kind: "docx" | "wiki";
  token: string;
};

type FeishuExtractMode = "raw" | "rich" | "both";

type RequirementState =
  | "draft"
  | "intake-reviewed"
  | "design"
  | "design-reviewed"
  | "implementing"
  | "validating"
  | "completed"
  | "archived";

type RequirementPhaseKey =
  | "intake"
  | "review-intake"
  | "design"
  | "review-design"
  | "breakdown"
  | "task-input-gen"
  | "validation"
  | "completion"
  | "archive";

type SessionStatus = "in_progress" | "completed" | "failed";

type SessionGateResult = "PASS" | "FAIL" | null;

type RequirementSessionState = {
  req_id: string;
  current_phase: RequirementPhaseKey;
  owner_agent: string;
  required_skills: string[];
  retrieved_context_hash: string;
  status: SessionStatus;
  outputs_completed: string[];
  outputs_pending: string[];
  last_gate_result: SessionGateResult;
  last_error: string | null;
  started_at: string;
  updated_at: string;
};

type RequirementRouteDecision = {
  state: RequirementState;
  phase: RequirementPhaseKey;
  outputs_completed: string[];
  outputs_pending: string[];
};

type GateCheckItem = {
  id: string;
  passed: boolean;
  message: string;
};

type GateEvaluation = {
  passed: boolean;
  checks: GateCheckItem[];
  requirementDir: string;
  requirementRelDir: string;
  fromState: RequirementState;
  toState: RequirementState;
};

type RuleBlock = {
  id: string;
  dedupKey: string;
  trigger: string;
  action: string;
};

type MindmapOutlineNode = {
  depth: number;
  label: string;
  line: number;
};

type MindmapExportFormat = "feishu" | "feishu-bullet" | "both";

const FLOW_STAGE_GUIDES: FlowStageGuide[] = [
  {
    key: "prd-source",
    label: "PRD Source",
    fileName: "01-prd-source.md",
    contextStage: "prd",
    inputs: ["Feishu/Jira requirement links", "Business goals", "Scope boundaries"],
    deliverables: ["Problem statement", "Goals and non-goals", "Acceptance criteria"],
  },
  {
    key: "test-mindmap",
    label: "Test Mindmap",
    fileName: "02-test-cases.mmd",
    contextStage: "test",
    inputs: ["01-prd-source.md"],
    deliverables: ["Critical paths", "Edge cases", "Risk-based test points"],
  },
  {
    key: "technical-solution",
    label: "Technical Solution",
    fileName: "03-technical-solution.md",
    contextStage: "technical-solution",
    inputs: ["01-prd-source.md", "02-test-cases.mmd"],
    deliverables: ["Architecture approach", "Tradeoffs", "Risk and fallback plan"],
  },
  {
    key: "api-design",
    label: "API Design",
    fileName: "04-api-design.md",
    contextStage: "api-design",
    inputs: ["03-technical-solution.md"],
    deliverables: ["Interface contract", "Backward compatibility", "Validation plan"],
  },
  {
    key: "ui-handoff",
    label: "UI Handoff",
    fileName: "05-ui-handoff.md",
    contextStage: "ui-design",
    inputs: ["03-technical-solution.md", "04-api-design.md", "Design source link"],
    deliverables: ["Screen/state mapping", "Interaction details", "Data contract mapping"],
  },
  {
    key: "task-breakdown",
    label: "Task Breakdown",
    fileName: "06-task-breakdown.yaml",
    contextStage: "task-breakdown",
    inputs: ["03-technical-solution.md", "04-api-design.md", "05-ui-handoff.md"],
    deliverables: ["Tasks with dependency graph", "Definition of done", "Milestones"],
  },
  {
    key: "task-assignment",
    label: "Task Assignment",
    fileName: "07-task-assignment.yaml",
    contextStage: "task-input",
    inputs: ["06-task-breakdown.yaml"],
    deliverables: ["Task owner/repo mapping", "Agent inputs", "Context retrieval query"],
  },
  {
    key: "delivery",
    label: "Delivery Result",
    fileName: "08-delivery.md",
    contextStage: "result",
    inputs: ["07-task-assignment.yaml", "Implementation PR links"],
    deliverables: ["Output summary", "Verification evidence", "Release and rollback notes"],
  },
  {
    key: "retro",
    label: "Retro and Context Writeback",
    fileName: "09-retro-context.md",
    contextStage: "experience",
    inputs: ["08-delivery.md"],
    deliverables: ["What worked/failed", "Reusable patterns", "Context writeback items"],
  },
];

const FLOW_STAGE_ALIAS: Record<string, FlowStageKey> = {
  "1": "prd-source",
  prd: "prd-source",
  "prd-source": "prd-source",
  requirement: "prd-source",
  "2": "test-mindmap",
  test: "test-mindmap",
  mindmap: "test-mindmap",
  "test-mindmap": "test-mindmap",
  "3": "technical-solution",
  solution: "technical-solution",
  tech: "technical-solution",
  "technical-solution": "technical-solution",
  "4": "api-design",
  api: "api-design",
  "api-design": "api-design",
  "5": "ui-handoff",
  ui: "ui-handoff",
  design: "ui-handoff",
  "ui-handoff": "ui-handoff",
  "6": "task-breakdown",
  breakdown: "task-breakdown",
  tasks: "task-breakdown",
  "task-breakdown": "task-breakdown",
  "7": "task-assignment",
  assign: "task-assignment",
  input: "task-assignment",
  "task-assignment": "task-assignment",
  "8": "delivery",
  result: "delivery",
  "delivery-result": "delivery",
  delivery: "delivery",
  "9": "retro",
  experience: "retro",
  retro: "retro",
};

type RequirementPhaseBlueprint = {
  owner_agent: string;
  required_skills: string[];
  required_outputs: string[];
  gate_type?: "manual";
};

const REQUIREMENT_PHASE_BLUEPRINTS: Record<RequirementPhaseKey, RequirementPhaseBlueprint> = {
  intake: {
    owner_agent: "requirement-manager",
    required_skills: ["req-create", "index-manager"],
    required_outputs: ["00-intake.md", "01-test-cases.mmd"],
  },
  "review-intake": {
    owner_agent: "requirement-manager",
    required_skills: [],
    required_outputs: [".review-intake.json"],
    gate_type: "manual",
  },
  design: {
    owner_agent: "design-manager",
    required_skills: ["design-create"],
    required_outputs: ["02-technical-solution.md", "03-api-design.yaml", "03-api-design.md", "04-ui-handoff.md"],
  },
  "review-design": {
    owner_agent: "design-manager",
    required_skills: [],
    required_outputs: [".review-design.json"],
    gate_type: "manual",
  },
  breakdown: {
    owner_agent: "design-manager",
    required_skills: ["design-change"],
    required_outputs: ["05-task-breakdown.yaml", "06-task-assignment.yaml"],
  },
  "task-input-gen": {
    owner_agent: "implementation-executor",
    required_skills: ["task-input-prepare", "workspace-setup"],
    required_outputs: ["task-input-*.md", "07-delivery.md", "sub-agent-dispatch.md", "sub-agent-dispatch.sh"],
  },
  validation: {
    owner_agent: "implementation-executor",
    required_skills: ["code-commit"],
    required_outputs: ["07-delivery.md"],
  },
  completion: {
    owner_agent: "requirement-manager",
    required_skills: ["requirement-completer", "experience-index"],
    required_outputs: ["08-retro.md"],
  },
  archive: {
    owner_agent: "experience-depositor",
    required_skills: ["requirement-archiver", "index-manager", "meta-maintainer"],
    required_outputs: [],
  },
};

const CONTEXT_BUDGET_TOKENS: Record<ContextBudgetLevel, number> = {
  l0: 500,
  l1: 1500,
  l2: 3000,
};

class AgentKitCliError extends Error {}

function agentkitInfo(message: string): void {
  console.log(`[agentkit] ${message}`);
}

function agentkitWarn(message: string): void {
  console.warn(`[agentkit][warn] ${message}`);
}

function agentkitError(message: string): void {
  console.error(`[agentkit][error] ${message}`);
}

function agentkitUsage(): void {
  console.log(`Usage:
  agentkit <command> [options]

Commands:
  bind             Bind local code repository to a context-engineering repository.
  req-dev          Unified requirement entry (create or continue a requirement flow).
  optimize-flow    Capture reusable rules/experience for next tasks.
  load-service     Analyze service repository and write reusable context under context/tech/services/.
  mindmap-export   Export Mermaid mindmap (.mmd) to Feishu-friendly outline txt.
  init             Initialize workflow directories and templates (legacy).
  flow-init        Scaffold PRD -> design -> task workflow documents (legacy).
  flow-next        Generate stage-specific agent input guide (legacy).
  sync-context     Update/verify context-hub lock metadata (legacy).
  review           Create review record and optional quality gate output (legacy).
  capture-experience Write task learnings back into context assets (legacy).
  bootstrap        Bootstrap global launcher/bindings, selected global agent commands, and optional project tool projections.
  install          Install commands/skills to project-local or user-global tool directories.
  install-global   Install a global 'agentkit' launcher into a bin directory.
  uninstall-global Remove a previously installed global launcher.
  help             Show this help message.

Examples:
  npm run init
  agentkit bind
  agentkit bind --repo-key backend --req-id req-20260301-demo
  agentkit bind --repo-key canvas-fe
  agentkit bind --show
  agentkit req-dev --task "优惠券发放改造" --frontend-repo https://git.company/fe.git --backend-repo https://git.company/be.git
  agentkit req-dev --prd-link "https://company.feishu.cn/docx/ABCDEF..." --prd-extract-mode both --frontend-repo https://git.company/fe.git --backend-repo https://git.company/be.git
  agentkit req-dev --task-id TASK-003
  agentkit req-dev --task "活动报名改造" --context-budget l1 --context-limit 8
  agentkit req-dev --id req-20260226-coupon --transition design:implementing --check-only
  agentkit req-dev --id req-20260226-coupon --dispatch-subagents
  agentkit optimize-flow --id req-20260226-coupon --type risk --insight "虚拟商品必须匹配虚拟钱包" --trigger "商品发放,钱包类型"
  agentkit load-service ~/code/web-app --name canvas-fe
  agentkit mindmap-export --input requirements/in-progress/req-20260226-xxx/01-test-cases.mmd --format feishu
  agentkit bootstrap
  agentkit bootstrap --targets claude,cursor,codex
  agentkit bootstrap --targets all
  agentkit install --scope global --target claude --force
  agentkit install --target claude --force
  agentkit install-global`);
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean; stdio?: "inherit" },
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    stdio: options?.stdio === "inherit" ? "inherit" : "pipe",
    encoding: "utf8",
  });

  const runResult: RunResult = {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error,
  };

  if (runResult.error && !options?.allowFailure) {
    throw runResult.error;
  }

  if (runResult.status !== 0 && !options?.allowFailure) {
    const details = runResult.stderr.trim() || runResult.stdout.trim() || "command failed";
    throw new AgentKitCliError(`${command} ${args.join(" ")} failed: ${details}`);
  }

  return runResult;
}

function agentkitRepoRoot(): string {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return process.cwd();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function agentkitTimestampUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function agentkitTimestampId(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}-${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
}

function agentkitSlugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug : "untitled";
}

function semanticSlugify(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function smartSlug(input: string, field: string): string {
  if (input.trim().length === 0) {
    throw new AgentKitCliError(`${field} cannot be empty.`);
  }
  const slug = semanticSlugify(input);
  if (slug.length > 0) {
    return slug;
  }
  throw new AgentKitCliError(`${field} must include at least one letter or digit to build a semantic id.`);
}

function stripDuplicateDatePrefixFromTaskSlug(taskSlug: string, datePart: string): string {
  const yyyy = datePart.slice(0, 4);
  const mm = datePart.slice(4, 6);
  const dd = datePart.slice(6, 8);
  const datePatterns = [
    `${datePart}-`,
    `${datePart.slice(0, 6)}-`,
    `${yyyy}-${mm}-${dd}-`,
    `${yyyy}-${mm}-`,
  ];

  for (const prefix of datePatterns) {
    if (taskSlug.startsWith(prefix)) {
      return taskSlug.slice(prefix.length).replace(/^-+/, "");
    }
  }
  return taskSlug;
}

function agentkitRequireInitialized(root: string): void {
  if (!existsSync(join(root, "agentkit.config.yml"))) {
    throw new AgentKitCliError("Project not initialized. Run 'agentkit init'.");
  }
  if (!existsSync(join(root, "workflow", "context-hub.lock"))) {
    throw new AgentKitCliError("Missing workflow/context-hub.lock. Run 'agentkit init'.");
  }
}

function agentkitEnsureGitignoreLine(root: string, line: string): void {
  const gitignorePath = join(root, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf8");
  }
  const lines = content.split(/\r?\n/);
  if (!lines.includes(line)) {
    const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    writeFileSync(gitignorePath, `${content}${suffix}${line}\n`, "utf8");
  }
}

function agentkitReadLockValue(filePath: string, key: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  const content = readFileSync(filePath, "utf8");
  const line = content.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return "";
  }
  return line.slice(key.length + 1);
}

function agentkitWriteLockFile(
  filePath: string,
  repo: string,
  ref: string,
  resolved: string,
  syncedAt: string,
  status: string,
): void {
  const content = `# Managed by agentkit. Use 'agentkit sync-context' to update.
CONTEXT_REPO_URL=${repo}
CONTEXT_REF=${ref}
CONTEXT_RESOLVED_REF=${resolved}
LAST_SYNCED_AT=${syncedAt}
LAST_SYNC_STATUS=${status}
`;
  writeFileSync(filePath, content, "utf8");
}

function isExecutable(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    return (statSync(filePath).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function agentkitTryHook(hookPath: string, args: string[]): void {
  if (isExecutable(hookPath)) {
    agentkitInfo(`Running hook: ${hookPath}`);
    const result = runCommand(hookPath, args, { allowFailure: true, stdio: "inherit" });
    if (result.status !== 0) {
      throw new AgentKitCliError(`Hook failed: ${hookPath}`);
    }
    return;
  }

  if (existsSync(hookPath)) {
    agentkitWarn(`Hook exists but is not executable: ${hookPath}`);
  }
}

function commandExists(command: string): boolean {
  const probe = runCommand("bash", ["-lc", `command -v "${command}" >/dev/null 2>&1`], {
    allowFailure: true,
  });
  return probe.status === 0;
}

function getValue(args: string[], index: number, optionName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new AgentKitCliError(`${optionName} requires a value.`);
  }
  return value;
}

function writeFileWithForce(
  root: string,
  targetPath: string,
  label: string,
  content: string,
  force: boolean,
): void {
  const relPath = relative(root, targetPath) || basename(targetPath);
  if (existsSync(targetPath) && !force) {
    agentkitWarn(`Skip existing ${label}: ${relPath}`);
    return;
  }
  writeFileSync(targetPath, content, "utf8");
  agentkitInfo(`Wrote ${label}: ${relPath}`);
}

function expandUserPath(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function looksLikeRemoteRepo(repo: string): boolean {
  return /:\/\//.test(repo) || /^[^/]+@[^:]+:.+/.test(repo);
}

function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseContextBudgetLevel(input: string): ContextBudgetLevel {
  const normalized = input.trim().toLowerCase();
  if (normalized === "l0" || normalized === "l1" || normalized === "l2") {
    return normalized;
  }
  throw new AgentKitCliError("Invalid --context-budget. Use l0, l1, or l2.");
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikeContextRepoRoot(root: string): boolean {
  return (
    existsSync(join(root, "requirements", "repo-links.yml")) &&
    existsSync(join(root, "workflow", "phase-skill-map.yaml"))
  );
}

function bindLocalConfigPath(repoRoot: string): string {
  return join(repoRoot, ".agentkit", "bind.local.json");
}

function bindGlobalConfigPath(): string {
  return join(homedir(), ".agentkit", "config.json");
}

function parseStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim().length > 0) {
      output[key] = item.trim();
    }
  }
  return output;
}

function readLocalBindConfig(repoRoot: string): LocalBindConfig {
  const parsed = readJsonObject(bindLocalConfigPath(repoRoot));
  if (!parsed) {
    return {};
  }
  return {
    context_root: typeof parsed.context_root === "string" ? parsed.context_root : undefined,
    repo_key: typeof parsed.repo_key === "string" ? parsed.repo_key : undefined,
    active_requirement_id:
      typeof parsed.active_requirement_id === "string" ? parsed.active_requirement_id : undefined,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
  };
}

function writeLocalBindConfig(repoRoot: string, config: LocalBindConfig): string {
  const filePath = bindLocalConfigPath(repoRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ...config,
        updated_at: agentkitTimestampUtc(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
}

function readGlobalBindConfig(): GlobalBindConfig {
  const parsed = readJsonObject(bindGlobalConfigPath());
  if (!parsed) {
    return {};
  }
  return {
    context_root: typeof parsed.context_root === "string" ? parsed.context_root : undefined,
    workspace_overrides: parseStringMap(parsed.workspace_overrides),
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
  };
}

function writeGlobalBindConfig(config: GlobalBindConfig): string {
  const filePath = bindGlobalConfigPath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ...config,
        workspace_overrides:
          config.workspace_overrides && Object.keys(config.workspace_overrides).length > 0
            ? Object.fromEntries(Object.entries(config.workspace_overrides).sort((a, b) => a[0].localeCompare(b[0])))
            : undefined,
        updated_at: agentkitTimestampUtc(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
}

function resolveOptionalLocalPath(baseRoot: string, rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  const expanded = expandUserPath(trimmed);
  const candidate = isAbsolute(expanded) ? expanded : resolve(baseRoot, expanded);
  return existsSync(candidate) ? candidate : null;
}

function findRepoKeyByUrl(repoLinks: RepoLinks, repoUrl: string): string | null {
  const normalizedTarget = repoUrl.trim();
  if (!normalizedTarget) {
    return null;
  }
  for (const [key, value] of Object.entries(repoLinks)) {
    if (value.trim() === normalizedTarget) {
      return key;
    }
  }
  const targetSlug = slugFromRepoValue(normalizedTarget);
  for (const [key, value] of Object.entries(repoLinks)) {
    if (slugFromRepoValue(value) === targetSlug) {
      return key;
    }
  }
  return null;
}

function listGitRemoteUrls(repoRoot: string): string[] {
  const probe = runCommand("git", ["-C", repoRoot, "remote", "-v"], { allowFailure: true });
  if (probe.status !== 0) {
    return [];
  }
  const urls = new Set<string>();
  for (const line of probe.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^[^\s]+\s+([^\s]+)\s+\((fetch|push)\)$/);
    if (match?.[1]) {
      urls.add(match[1]);
    }
  }
  return [...urls];
}

function inferRepoKeyForWorkspace(repoRoot: string, contextRoot: string): string {
  const repoLinksFile = join(contextRoot, "requirements", "repo-links.yml");
  const repoLinks = readRepoLinks(repoLinksFile);
  for (const remoteUrl of listGitRemoteUrls(repoRoot)) {
    const matched = findRepoKeyByUrl(repoLinks, remoteUrl);
    if (matched) {
      return matched;
    }
  }
  const folderSlug = agentkitSlugify(basename(repoRoot));
  for (const [key, value] of Object.entries(repoLinks)) {
    if (agentkitSlugify(key) === folderSlug || slugFromRepoValue(value) === folderSlug) {
      return key;
    }
  }
  return "";
}

function readGitLocalConfig(repoRoot: string, key: string): string {
  const probe = runCommand("git", ["-C", repoRoot, "config", "--local", "--get", key], { allowFailure: true });
  if (probe.status !== 0) {
    return "";
  }
  return probe.stdout.trim();
}

function writeGitLocalConfig(repoRoot: string, key: string, value: string): void {
  runCommand("git", ["-C", repoRoot, "config", "--local", key, value], { allowFailure: false });
}

function resolveContextRootPath(baseRoot: string, contextRootRaw: string): string {
  const expanded = expandUserPath(contextRootRaw.trim());
  const resolvedPath = isAbsolute(expanded) ? expanded : resolve(baseRoot, expanded);
  if (!existsSync(resolvedPath)) {
    throw new AgentKitCliError(`Context root does not exist: ${resolvedPath}`);
  }
  if (!looksLikeContextRepoRoot(resolvedPath)) {
    throw new AgentKitCliError(
      `Invalid context root: ${resolvedPath}. Missing requirements/repo-links.yml or workflow/phase-skill-map.yaml.`,
    );
  }
  return resolvedPath;
}

function resolveBoundContextRoot(repoRoot: string): { path: string; source: string } | null {
  const fromGit = readGitLocalConfig(repoRoot, "agentkit.contextRoot");
  if (fromGit) {
    const resolved = resolveContextRootPath(repoRoot, fromGit);
    return { path: resolved, source: "git-config" };
  }

  const localBind = readLocalBindConfig(repoRoot);
  if (localBind.context_root) {
    const resolved = resolveContextRootPath(repoRoot, localBind.context_root);
    return { path: resolved, source: "bind.local.json" };
  }

  const globalBind = readGlobalBindConfig();
  if (globalBind.context_root) {
    const resolved = resolveContextRootPath(repoRoot, globalBind.context_root);
    return { path: resolved, source: "global-config" };
  }

  const fromEnv = (process.env.AGENTKIT_CONTEXT_ROOT || "").trim();
  if (fromEnv) {
    const resolved = resolveContextRootPath(repoRoot, fromEnv);
    return { path: resolved, source: "env" };
  }
  return null;
}

function resolveReqDevRoot(repoRoot: string, explicitContextRoot: string): { path: string; source: string } {
  if (explicitContextRoot.trim()) {
    return {
      path: resolveContextRootPath(repoRoot, explicitContextRoot),
      source: "option",
    };
  }
  if (looksLikeContextRepoRoot(repoRoot)) {
    return {
      path: repoRoot,
      source: "repo-root",
    };
  }
  const bound = resolveBoundContextRoot(repoRoot);
  if (bound) {
    return bound;
  }
  return {
    path: repoRoot,
    source: "repo-root-fallback",
  };
}

function readProjectRepoKey(repoRoot: string): string {
  const parsed = readJsonObject(join(repoRoot, ".agentkit", "project.json"));
  if (!parsed) {
    return "";
  }
  const key = parsed.repo_key;
  return typeof key === "string" ? key.trim() : "";
}

function compactText(value: string, maxLength: number): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxLength), truncated: true };
}

function parseMindmapExportFormat(value: string): MindmapExportFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "feishu" || normalized === "feishu-bullet" || normalized === "both") {
    return normalized;
  }
  throw new AgentKitCliError("Invalid --format. Use feishu, feishu-bullet, or both.");
}

function countMindmapIndentDepth(line: string): number {
  let spaces = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === " ") {
      spaces += 1;
      continue;
    }
    if (ch === "\t") {
      spaces += 2;
      continue;
    }
    break;
  }
  return Math.floor(spaces / 2);
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function extractMindmapNodeLabel(rawValue: string): string {
  const trimmed = rawValue
    .replace(/\s*::icon\([^)]+\)\s*$/gi, "")
    .replace(/\s+:::+[A-Za-z0-9_-]+\s*$/g, "")
    .trim();
  if (!trimmed) {
    return "";
  }

  const shapePatterns = [
    /^[A-Za-z0-9_.-]+\s*\(\((.+)\)\)\s*$/u,
    /^[A-Za-z0-9_.-]+\s*\(\[(.+)\]\)\s*$/u,
    /^[A-Za-z0-9_.-]+\s*\[(.+)\]\s*$/u,
    /^[A-Za-z0-9_.-]+\s*\{(.+)\}\s*$/u,
    /^[A-Za-z0-9_.-]+\s*\((.+)\)\s*$/u,
    /^root\s*\(\((.+)\)\)\s*$/u,
  ];
  for (const pattern of shapePatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return stripOuterQuotes(match[1].trim());
    }
  }

  return stripOuterQuotes(trimmed);
}

function parseMermaidMindmap(content: string): MindmapOutlineNode[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const parsedNodes: MindmapOutlineNode[] = [];
  let foundMindmapHeader = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) {
      continue;
    }
    if (!foundMindmapHeader) {
      if (trimmed !== "mindmap") {
        throw new AgentKitCliError("Invalid .mmd content: first non-empty line must be 'mindmap'.");
      }
      foundMindmapHeader = true;
      continue;
    }
    if (/^(classDef|class|style|linkStyle|click)\b/i.test(trimmed)) {
      continue;
    }

    const label = extractMindmapNodeLabel(trimmed);
    if (!label) {
      continue;
    }
    parsedNodes.push({
      depth: countMindmapIndentDepth(line),
      label,
      line: index + 1,
    });
  }

  if (!foundMindmapHeader) {
    throw new AgentKitCliError("Invalid .mmd content: missing 'mindmap' header.");
  }
  if (parsedNodes.length === 0) {
    throw new AgentKitCliError("Invalid .mmd content: no mindmap nodes found.");
  }

  let minDepth = parsedNodes[0].depth;
  for (const node of parsedNodes) {
    if (node.depth < minDepth) {
      minDepth = node.depth;
    }
  }
  for (const node of parsedNodes) {
    node.depth = Math.max(0, node.depth - minDepth);
  }

  return parsedNodes;
}

function buildFeishuOutlinePayload(nodes: MindmapOutlineNode[]): { title: string; body: MindmapOutlineNode[] } {
  const title = nodes[0]?.label || "Untitled";
  if (nodes.length <= 1) {
    return { title, body: [] };
  }

  const body = nodes.slice(1).map((node) => ({ ...node }));
  let minDepth = body[0].depth;
  for (const node of body) {
    if (node.depth < minDepth) {
      minDepth = node.depth;
    }
  }
  if (minDepth > 0) {
    for (const node of body) {
      node.depth = Math.max(0, node.depth - minDepth);
    }
  }

  return { title, body };
}

function renderMindmapFeishuOutline(nodes: MindmapOutlineNode[], withBulletPrefix: boolean): string {
  const payload = buildFeishuOutlinePayload(nodes);
  const lines: string[] = [payload.title, ""];

  for (const node of payload.body) {
    const prefix = withBulletPrefix ? "- " : "";
    lines.push(`${"\t".repeat(node.depth)}${prefix}${node.label}`);
  }

  return `${lines.join("\n")}\n`;
}

function defaultMindmapOutputPath(
  inputFile: string,
  format: "feishu" | "feishu-bullet",
): string {
  const extension = extname(inputFile);
  const stem = extension.length > 0 ? inputFile.slice(0, -extension.length) : inputFile;
  if (format === "feishu") {
    return `${stem}.feishu-outline.txt`;
  }
  return `${stem}.feishu-bullet.txt`;
}

function parseEnvAssignmentLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = normalized.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }
  const key = normalized.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  const rawValue = normalized.slice(equalsIndex + 1).trim();
  let value = rawValue;
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFileIntoProcess(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, "utf8");
  const loadedKeys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const assignment = parseEnvAssignmentLine(line);
    if (!assignment) {
      continue;
    }
    const existingValue = process.env[assignment.key]?.trim();
    if (existingValue) {
      continue;
    }
    process.env[assignment.key] = assignment.value;
    loadedKeys.push(assignment.key);
  }
  return loadedKeys;
}

function canUseInteractivePrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function isPromptCancelledError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "ExitPromptError");
}

async function runPrompt<T>(runner: () => Promise<T>): Promise<T> {
  try {
    return await runner();
  } catch (error) {
    if (isPromptCancelledError(error)) {
      throw new AgentKitCliError("Prompt cancelled.");
    }
    throw error;
  }
}

async function promptLine(question: string, defaultValue: string = ""): Promise<string> {
  const answer = await runPrompt(() =>
    promptInput({
      message: question,
      default: defaultValue || undefined,
    }),
  );
  const trimmed = answer.trim();
  if (!trimmed && defaultValue) {
    return defaultValue;
  }
  return trimmed;
}

async function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  return runPrompt(() =>
    promptConfirm({
      message: question,
      default: defaultYes,
    }),
  );
}

type RequirementChoice = {
  requirementId: string;
  title: string;
  state: RequirementState | "unknown";
};

function inferRequirementTitleFromIntake(requirementDir: string, fallback: string): string {
  const intakePath = join(requirementDir, "00-intake.md");
  if (!existsSync(intakePath)) {
    return fallback;
  }
  const content = readFileSync(intakePath, "utf8");
  const titleMatch = content.match(/^#\s+Requirement Intake:\s*(.+)$/m);
  if (!titleMatch?.[1]) {
    return fallback;
  }
  return titleMatch[1].trim();
}

function listInProgressRequirementChoices(root: string): RequirementChoice[] {
  const inProgressDir = join(root, "requirements", "in-progress");
  if (!existsSync(inProgressDir)) {
    return [];
  }
  const indexPath = join(root, "requirements", "INDEX.md");
  const indexContent = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  const indexStateByReqId = new Map<string, RequirementState | "unknown">();
  for (const rawLine of indexContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idMatch = line.match(/^- (req-[^|\s]+)\s+\|/);
    if (!idMatch?.[1]) {
      continue;
    }
    const stateMatch = line.match(/\bstate=([a-z-]+)/i);
    const stateRaw = stateMatch?.[1] || "";
    const state = isRequirementState(stateRaw) ? stateRaw : "unknown";
    indexStateByReqId.set(idMatch[1], state);
  }

  const entries = readdirSync(inProgressDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^req-/.test(entry.name))
    .map((entry) => {
      const requirementId = entry.name;
      const requirementDir = join(inProgressDir, requirementId);
      const title = inferRequirementTitleFromIntake(requirementDir, requirementId);
      return {
        requirementId,
        title,
        state: indexStateByReqId.get(requirementId) || "unknown",
      };
    })
    .sort((a, b) => b.requirementId.localeCompare(a.requirementId));
  return entries;
}

async function promptRequirementChoice(root: string): Promise<{ requirementId: string; createNew: boolean }> {
  const choices = listInProgressRequirementChoices(root);
  if (choices.length === 0) {
    return { requirementId: "", createNew: true };
  }
  if (choices.length === 1) {
    const only = choices[0];
    const reuse = await promptYesNo(
      `Found 1 in-progress requirement (${only.requirementId}, state=${only.state}). Continue with it?`,
      true,
    );
    if (reuse) {
      return { requirementId: only.requirementId, createNew: false };
    }
    return { requirementId: "", createNew: true };
  }
  const selected = await runPrompt(() =>
    promptSelect({
      message: "Choose an in-progress requirement",
      choices: [
        ...choices.map((item) => ({
          name: `${item.requirementId} [state=${item.state}] ${item.title}`,
          value: item.requirementId,
        })),
        {
          name: "Create new requirement",
          value: "__create_new__",
        },
      ],
    }),
  );
  if (selected === "__create_new__") {
    return { requirementId: "", createNew: true };
  }
  return {
    requirementId: selected,
    createNew: false,
  };
}

function parseNaturalLanguageList(value: string): string[] {
  return value
    .split(/[,\n;，；]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeOpenApiPath(value: string): string {
  let normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
  return normalized.replace(/\s+/g, "");
}

async function maybeWriteInteractiveDesignDraft(root: string, requirementId: string): Promise<void> {
  const requirementDir = findRequirementDir(root, requirementId).dir;
  const sessionFile = join(requirementDir, ".session-state.json");
  const session = readRequirementSessionState(sessionFile);
  if (!session || session.current_phase !== "design") {
    return;
  }

  const missingDesignOutputs = session.outputs_pending.filter((item) =>
    ["02-technical-solution.md", "03-api-design.yaml", "03-api-design.md", "04-ui-handoff.md"].includes(item),
  );
  if (missingDesignOutputs.length === 0) {
    return;
  }

  const shouldDraft = await promptYesNo(
    "Current phase is design. Generate 02/03/04 draft files via interactive Q&A now?",
    true,
  );
  if (!shouldDraft) {
    return;
  }

  const architectureGoal = await promptLine("Architecture goal (one sentence)");
  const architectureDetails = parseNaturalLanguageList(
    await promptLine("Key architecture/data-flow points (comma-separated)"),
  );
  const apiItems = parseNaturalLanguageList(
    await promptLine("API paths (comma-separated, e.g. /api/projects/{id}/members)"),
  );
  const uiItems = parseNaturalLanguageList(await promptLine("Main UI pages/entries (comma-separated)"));
  const riskPlan = parseNaturalLanguageList(await promptLine("Risks and rollback plan (comma-separated)"));

  const normalizedApiPaths = dedupeAndSort(
    apiItems.map((item) => normalizeOpenApiPath(item)).filter((item) => item.length > 0),
  );
  if (normalizedApiPaths.length === 0) {
    normalizedApiPaths.push("/todo-endpoint");
  }
  const normalizedUiItems = dedupeAndSort(uiItems.length > 0 ? uiItems : ["Collaborative canvas page"]);
  const normalizedArchitectureDetails = dedupeAndSort(
    architectureDetails.length > 0 ? architectureDetails : ["Align backend and frontend contract-first delivery"],
  );
  const normalizedRiskPlan = dedupeAndSort(
    riskPlan.length > 0 ? riskPlan : ["Roll out behind feature flag; rollback by disabling flag"],
  );

  const solutionContent = `# Technical Solution: ${inferRequirementTitleFromIntake(requirementDir, requirementId)}

## Inputs

- 00-intake.md
- 01-test-cases.mmd

## Architecture

- Goal: ${architectureGoal || "Deliver stable collaboration and notification capability for the scoped P0 features."}
${normalizedArchitectureDetails.map((item) => `- ${item}`).join("\n")}

## Tradeoffs and Risks

${normalizedRiskPlan.map((item) => `- ${item}`).join("\n")}
`;

  const apiYamlBlocks = normalizedApiPaths
    .map(
      (apiPath) => `  ${apiPath}:
    post:
      summary: ${yamlQuote(`TODO: ${apiPath}`)}
      responses:
        "200":
          description: OK`,
    )
    .join("\n");

  const apiYamlContent = `openapi: 3.1.0
info:
  title: ${yamlQuote(`${inferRequirementTitleFromIntake(requirementDir, requirementId)} API`)}
  version: "0.1.0"
paths:
${apiYamlBlocks}
components:
  schemas: {}
`;

  const apiMdContent = `# API Design: ${inferRequirementTitleFromIntake(requirementDir, requirementId)}

## Inputs

- 02-technical-solution.md

## Contract

- Endpoint/Topic: ${normalizedApiPaths.join(", ")}
- Request: Define request schema per endpoint in 03-api-design.yaml.
- Response: Define success/error schema per endpoint in 03-api-design.yaml.

## Compatibility

- Maintain backward compatibility via additive fields and guarded rollout.
`;

  const uiHandoffContent = `# UI Handoff: ${inferRequirementTitleFromIntake(requirementDir, requirementId)}

## Inputs

- 02-technical-solution.md
- 03-api-design.md
- Design Link (Figma): TODO

## UI State Mapping

${normalizedUiItems.map((item) => `- ${item}`).join("\n")}
`;

  writeFileSync(join(requirementDir, "02-technical-solution.md"), solutionContent, "utf8");
  writeFileSync(join(requirementDir, "03-api-design.yaml"), apiYamlContent, "utf8");
  writeFileSync(join(requirementDir, "03-api-design.md"), apiMdContent, "utf8");
  writeFileSync(join(requirementDir, "04-ui-handoff.md"), uiHandoffContent, "utf8");
  agentkitInfo("Generated design drafts: 02-technical-solution.md, 03-api-design.yaml, 03-api-design.md, 04-ui-handoff.md");
}

async function maybeHandleInteractiveReview(root: string, requirementId: string): Promise<boolean> {
  const requirementDir = findRequirementDir(root, requirementId).dir;
  const sessionFile = join(requirementDir, ".session-state.json");
  const session = readRequirementSessionState(sessionFile);
  if (!session) {
    return false;
  }
  if (session.current_phase !== "review-intake" && session.current_phase !== "review-design") {
    return false;
  }

  const reviewTarget = session.current_phase === "review-intake" ? "intake" : "design";
  const approved = await promptYesNo(`Current phase is ${session.current_phase}. Approve now?`, false);
  const reviewer = await promptLine("Reviewer", process.env.USER || "unknown");
  const defaultNotes = approved ? "通过" : "需修改";
  const notes = await promptLine("Review notes", defaultNotes);
  const reviewFileName = reviewTarget === "intake" ? ".review-intake.json" : ".review-design.json";
  const payload = {
    reviewer,
    approved,
    notes,
    timestamp: agentkitTimestampUtc(),
  };
  writeFileSync(join(requirementDir, reviewFileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  agentkitInfo(`Review file updated: ${relative(root, join(requirementDir, reviewFileName))}`);
  return true;
}

function maybeLoadReqDevFeishuEnv(root: string): { loadedFiles: string[]; loadedKeys: string[] } {
  const candidates = [join(root, "workflow", "secrets", "feishu.env"), join(root, ".env")];
  const loadedFiles: string[] = [];
  const loadedKeys = new Set<string>();
  for (const filePath of candidates) {
    const keys = loadEnvFileIntoProcess(filePath);
    if (keys.length === 0) {
      continue;
    }
    loadedFiles.push(filePath);
    for (const key of keys) {
      loadedKeys.add(key);
    }
  }
  return { loadedFiles, loadedKeys: [...loadedKeys].sort((a, b) => a.localeCompare(b)) };
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AgentKitCliError(`Missing environment variable: ${name}`);
  }
  return value;
}

function normalizeFeishuBaseUrl(): string {
  const configured = process.env.AGENTKIT_FEISHU_BASE_URL?.trim();
  if (!configured) {
    return "https://open.feishu.cn";
  }
  return configured.replace(/\/+$/, "");
}

function parseFeishuLinkToken(prdLink: string): FeishuLinkToken {
  const link = prdLink.trim();
  const docxMatch = link.match(/\/docx\/([a-zA-Z0-9]+)(?:[/?#]|$)/);
  if (docxMatch?.[1]) {
    return { kind: "docx", token: docxMatch[1] };
  }

  const wikiMatch = link.match(/\/wiki\/([a-zA-Z0-9]+)(?:[/?#]|$)/);
  if (wikiMatch?.[1]) {
    return { kind: "wiki", token: wikiMatch[1] };
  }

  throw new AgentKitCliError("Unsupported PRD link. Supported formats: /docx/<token> or /wiki/<token>.");
}

function parseFeishuData(payload: Record<string, unknown>, apiName: string): Record<string, unknown> {
  const rawCode = payload.code;
  const code =
    typeof rawCode === "number"
      ? rawCode
      : Number.parseInt(typeof rawCode === "string" ? rawCode : "0", 10);
  if (Number.isFinite(code) && code !== 0) {
    const rawMsg = payload.msg;
    const message = typeof rawMsg === "string" ? rawMsg : "unknown error";
    throw new AgentKitCliError(`Feishu API '${apiName}' failed: code=${code}, msg=${message}`);
  }

  const data = payload.data;
  if (!data || typeof data !== "object") {
    return {};
  }
  return data as Record<string, unknown>;
}

function feishuCurlJsonRequest(
  method: "GET" | "POST",
  url: string,
  accessToken?: string,
  body?: string,
): Record<string, unknown> {
  if (!commandExists("curl")) {
    throw new AgentKitCliError("curl is required for Feishu PRD fetch, but it is not available.");
  }

  const args: string[] = ["-sS", "-L", "-X", method, url, "--write-out", "\n%{http_code}"];
  if (accessToken) {
    args.push("-H", `Authorization: Bearer ${accessToken}`);
  }
  if (body) {
    args.push("-H", "Content-Type: application/json; charset=utf-8", "--data", body);
  }

  const result = runCommand("curl", args, { allowFailure: true });
  if (result.status !== 0) {
    const details = result.stderr.trim() || "curl request failed";
    throw new AgentKitCliError(`Feishu API request failed: ${details}`);
  }

  const output = result.stdout;
  const markerIndex = output.lastIndexOf("\n");
  if (markerIndex < 0) {
    throw new AgentKitCliError("Invalid response from Feishu API (missing status code).");
  }
  const responseBody = output.slice(0, markerIndex);
  const statusText = output.slice(markerIndex + 1).trim();
  const statusCode = Number.parseInt(statusText, 10);
  if (!Number.isFinite(statusCode)) {
    throw new AgentKitCliError("Invalid response status code from Feishu API.");
  }
  if (statusCode < 200 || statusCode >= 300) {
    const snippet = compactText(responseBody.trim(), 500).text;
    throw new AgentKitCliError(`Feishu API HTTP ${statusCode}: ${snippet || "empty response"}`);
  }

  try {
    const parsed = JSON.parse(responseBody);
    if (!parsed || typeof parsed !== "object") {
      throw new AgentKitCliError("Feishu API returned non-object JSON.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const snippet = compactText(responseBody, 500).text;
    if (error instanceof AgentKitCliError) {
      throw error;
    }
    throw new AgentKitCliError(`Failed to parse Feishu API response JSON: ${snippet}`);
  }
}

function resolveFeishuDocxToken(baseUrl: string, accessToken: string, linkToken: FeishuLinkToken): string {
  if (linkToken.kind === "docx") {
    return linkToken.token;
  }

  const wikiApi = `${baseUrl}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(linkToken.token)}`;
  const wikiPayload = feishuCurlJsonRequest("GET", wikiApi, accessToken);
  const wikiData = parseFeishuData(wikiPayload, "wiki.get_node");

  let objType = "";
  let objToken = "";
  if (typeof wikiData.obj_type === "string") {
    objType = wikiData.obj_type;
  }
  if (typeof wikiData.obj_token === "string") {
    objToken = wikiData.obj_token;
  }
  const node = wikiData.node;
  if (node && typeof node === "object") {
    const nodeRecord = node as Record<string, unknown>;
    if (!objType && typeof nodeRecord.obj_type === "string") {
      objType = nodeRecord.obj_type;
    }
    if (!objToken && typeof nodeRecord.obj_token === "string") {
      objToken = nodeRecord.obj_token;
    }
  }

  if (!objToken) {
    throw new AgentKitCliError("Unable to resolve wiki token to docx token.");
  }
  if (objType && objType.toLowerCase() !== "docx") {
    throw new AgentKitCliError(`Unsupported wiki node type '${objType}'. Only docx is supported.`);
  }
  return objToken;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseFeishuExtractMode(value: string): FeishuExtractMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "rich" || normalized === "both") {
    return normalized;
  }
  throw new AgentKitCliError("Invalid --prd-extract-mode. Use raw, rich, or both.");
}

function normalizeFeishuText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function renderFeishuTextStyle(content: string, styleValue: unknown): string {
  if (!content) {
    return content;
  }
  const style = asRecord(styleValue);
  if (!style) {
    return content;
  }

  let output = content;
  if (style.inline_code === true) {
    const ticks = output.includes("`") ? "``" : "`";
    output = `${ticks}${output}${ticks}`;
  }
  if (style.bold === true) {
    output = `**${output}**`;
  }
  if (style.italic === true) {
    output = `*${output}*`;
  }
  if (style.strikethrough === true) {
    output = `~~${output}~~`;
  }
  if (style.underline === true) {
    output = `<u>${output}</u>`;
  }
  return output;
}

function renderFeishuElements(elementsValue: unknown, withStyle: boolean): string {
  if (!Array.isArray(elementsValue)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of elementsValue) {
    const element = asRecord(item);
    if (!element) {
      continue;
    }

    const textRun = asRecord(element.text_run);
    if (textRun) {
      const content = typeof textRun.content === "string" ? normalizeFeishuText(textRun.content) : "";
      if (!content) {
        continue;
      }
      const text = withStyle ? renderFeishuTextStyle(content, textRun.text_element_style) : content;
      parts.push(text);
      continue;
    }

    const mentionDoc = asRecord(element.mention_doc);
    if (mentionDoc) {
      const titleRaw = typeof mentionDoc.title === "string" ? mentionDoc.title : "";
      const title = titleRaw || "Document";
      const url = typeof mentionDoc.url === "string" ? mentionDoc.url : "";
      const markdown = url ? `[${title}](${url})` : title;
      const text = withStyle ? renderFeishuTextStyle(markdown, mentionDoc.text_element_style) : title;
      parts.push(text);
      continue;
    }
  }

  return parts.join("");
}

function getFeishuBlockContentRecord(block: Record<string, unknown>): Record<string, unknown> | null {
  const keys = [
    "page",
    "text",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "bullet",
    "ordered",
    "quote",
    "quote_container",
  ];

  for (const key of keys) {
    const value = asRecord(block[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function getFeishuBlockInlineText(block: Record<string, unknown>, withStyle: boolean): string {
  const contentRecord = getFeishuBlockContentRecord(block);
  if (!contentRecord) {
    return "";
  }
  const text = renderFeishuElements(contentRecord.elements, withStyle);
  return text.trim();
}

function getFeishuBlockType(block: Record<string, unknown>): number {
  const raw = block.block_type;
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function boardAnchorId(token: string): string {
  return `board-${token.trim().toLowerCase()}`;
}

function renderBoardReference(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    return "[Feishu Board]";
  }
  return `[Feishu Board: ${normalized}](#${boardAnchorId(normalized)})`;
}

function extractFeishuPlainText(
  blockId: string,
  blockMap: Map<string, Record<string, unknown>>,
  visited: Set<string>,
): string {
  if (visited.has(blockId)) {
    return "";
  }
  visited.add(blockId);

  const block = blockMap.get(blockId);
  if (!block) {
    return "";
  }

  const fragments: string[] = [];
  const inlineText = getFeishuBlockInlineText(block, false);
  if (inlineText) {
    fragments.push(inlineText);
  }

  const blockType = getFeishuBlockType(block);
  if (blockType === 43) {
    const board = asRecord(block.board);
    const token = typeof board?.token === "string" ? board.token : "";
    fragments.push(token ? renderBoardReference(token) : "Feishu Board");
  }

  const childIds = asStringArray(block.children);
  for (const childId of childIds) {
    const childText = extractFeishuPlainText(childId, blockMap, visited).trim();
    if (childText) {
      fragments.push(childText);
    }
  }

  return fragments.join("\n");
}

function toMarkdownTableCellText(value: string): string {
  const normalized = normalizeFeishuText(value).trim();
  if (!normalized) {
    return " ";
  }
  return normalized.replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
}

function renderFeishuTable(block: Record<string, unknown>, blockMap: Map<string, Record<string, unknown>>): string[] {
  const table = asRecord(block.table);
  const property = asRecord(table?.property);
  const cells = asStringArray(table?.cells);

  let columnSize = 0;
  if (typeof property?.column_size === "number" && property.column_size > 0) {
    columnSize = property.column_size;
  }
  if (columnSize <= 0) {
    return [];
  }

  let rowSize = 0;
  if (typeof property?.row_size === "number" && property.row_size > 0) {
    rowSize = property.row_size;
  }
  if (rowSize <= 0) {
    rowSize = Math.ceil(cells.length / columnSize);
  }
  if (rowSize <= 0) {
    return [];
  }

  const rows: string[][] = [];
  for (let rowIndex = 0; rowIndex < rowSize; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = 0; colIndex < columnSize; colIndex += 1) {
      const cellIndex = rowIndex * columnSize + colIndex;
      const cellId = cells[cellIndex];
      if (!cellId) {
        row.push(" ");
        continue;
      }
      const plain = extractFeishuPlainText(cellId, blockMap, new Set<string>());
      row.push(toMarkdownTableCellText(plain));
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const header = rows[0];
  const output: string[] = [];
  output.push(`| ${header.join(" | ")} |`);
  output.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    output.push(`| ${rows[rowIndex].join(" | ")} |`);
  }
  return output;
}

function finalizeMarkdownLines(lines: string[]): string {
  const normalized: string[] = [];
  let previousBlank = true;

  for (const line of lines) {
    const trimmedRight = line.replace(/[ \t]+$/g, "");
    const blank = trimmedRight.length === 0;
    if (blank) {
      if (!previousBlank) {
        normalized.push("");
      }
      previousBlank = true;
      continue;
    }
    normalized.push(trimmedRight);
    previousBlank = false;
  }

  while (normalized.length > 0 && normalized[0] === "") {
    normalized.shift();
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }

  return normalized.join("\n");
}

function renderFeishuBlocksAsMarkdown(documentToken: string, blocks: Record<string, unknown>[]): string {
  const blockMap = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const blockId = typeof block.block_id === "string" ? block.block_id : "";
    if (!blockId) {
      continue;
    }
    blockMap.set(blockId, block);
  }
  if (blockMap.size === 0) {
    return "";
  }

  const root =
    blockMap.get(documentToken) ||
    blocks.find((item) => getFeishuBlockType(item) === 1) ||
    null;
  const topLevelIds = root
    ? asStringArray(root.children)
    : blocks
        .filter((item) => {
          const parent = typeof item.parent_id === "string" ? item.parent_id : "";
          return parent.length === 0 && typeof item.block_id === "string";
        })
        .map((item) => String(item.block_id));

  const headingByType: Record<number, string> = {
    3: "#",
    4: "##",
    5: "###",
    6: "####",
    7: "#####",
    8: "######",
  };

  const visited = new Set<string>();

  const renderBlockGroup = (blockIds: string[], listDepth: number): string[] => {
    const lines: string[] = [];
    let previousList = false;

    for (const blockId of blockIds) {
      const block = blockMap.get(blockId);
      if (!block) {
        continue;
      }

      const type = getFeishuBlockType(block);
      const isList = type === 12 || type === 13;
      const blockLines = renderSingleBlock(blockId, listDepth);
      if (blockLines.length === 0) {
        continue;
      }

      if (lines.length > 0 && !(previousList && isList)) {
        lines.push("");
      }
      lines.push(...blockLines);
      previousList = isList;
    }

    return lines;
  };

  const renderSingleBlock = (blockId: string, listDepth: number): string[] => {
    if (visited.has(blockId)) {
      return [];
    }
    visited.add(blockId);

    const block = blockMap.get(blockId);
    if (!block) {
      return [];
    }

    const type = getFeishuBlockType(block);
    const childIds = asStringArray(block.children);

    if (type === 12) {
      const itemText = getFeishuBlockInlineText(block, true).replace(/\n+/g, " ").trim();
      const lines = [`${"  ".repeat(listDepth)}- ${itemText || "(empty item)"}`];
      const childLines = renderBlockGroup(childIds, listDepth + 1);
      if (childLines.length > 0) {
        lines.push(...childLines);
      }
      return lines;
    }

    if (type === 13) {
      const ordered = asRecord(block.ordered);
      const style = asRecord(ordered?.style);
      const sequenceRaw = typeof style?.sequence === "string" ? style.sequence.trim() : "";
      const marker = /^\d+$/.test(sequenceRaw) ? `${sequenceRaw}.` : "1.";
      const itemText = getFeishuBlockInlineText(block, true).replace(/\n+/g, " ").trim();
      const lines = [`${"  ".repeat(listDepth)}${marker} ${itemText || "(empty item)"}`];
      const childLines = renderBlockGroup(childIds, listDepth + 1);
      if (childLines.length > 0) {
        lines.push(...childLines);
      }
      return lines;
    }

    if (type === 31) {
      const tableLines = renderFeishuTable(block, blockMap);
      if (tableLines.length > 0) {
        return tableLines;
      }
      return renderBlockGroup(childIds, listDepth);
    }

    if (type === 19) {
      const innerLines = renderBlockGroup(childIds, listDepth);
      const lines = innerLines.length > 0 ? innerLines : ["(empty callout)"];
      return ["> [!NOTE]", ...lines.map((line) => (line.length > 0 ? `> ${line}` : ">"))];
    }

    if (type === 34) {
      const innerLines = renderBlockGroup(childIds, listDepth);
      if (innerLines.length === 0) {
        return [">"];
      }
      return innerLines.map((line) => (line.length > 0 ? `> ${line}` : ">"));
    }

    if (type === 43) {
      const board = asRecord(block.board);
      const token = typeof board?.token === "string" ? board.token : "";
      return [token ? renderBoardReference(token) : "[Feishu Board]"];
    }

    const headingMarker = headingByType[type];
    const inlineText = getFeishuBlockInlineText(block, true);
    if (headingMarker) {
      const title = inlineText || "Untitled";
      return [`${headingMarker} ${title}`];
    }

    const lines: string[] = [];
    if (inlineText) {
      lines.push(inlineText);
    }
    const childLines = renderBlockGroup(childIds, listDepth);
    if (childLines.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(...childLines);
    }
    return lines;
  };

  const rendered = renderBlockGroup(topLevelIds, 0);
  return finalizeMarkdownLines(rendered);
}

function fetchFeishuDocumentBlocks(
  baseUrl: string,
  accessToken: string,
  documentToken: string,
): { items: Record<string, unknown>[]; pages: Record<string, unknown>[] } {
  const items: Record<string, unknown>[] = [];
  const pages: Record<string, unknown>[] = [];

  let hasMore = true;
  let pageToken = "";
  let requestCount = 0;

  while (hasMore) {
    requestCount += 1;
    if (requestCount > 100) {
      throw new AgentKitCliError("Too many pagination requests while fetching Feishu doc blocks.");
    }

    const url = new URL(`${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks`);
    url.searchParams.set("page_size", "500");
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const blocksPayload = feishuCurlJsonRequest("GET", url.toString(), accessToken);
    pages.push(blocksPayload);
    const blocksData = parseFeishuData(blocksPayload, "docx.blocks");
    if (Array.isArray(blocksData.items)) {
      for (const item of blocksData.items) {
        const record = asRecord(item);
        if (!record) {
          continue;
        }
        const blockId = typeof record.block_id === "string" ? record.block_id : "";
        if (!blockId) {
          continue;
        }
        items.push(record);
      }
    }

    hasMore = blocksData.has_more === true;
    pageToken = typeof blocksData.page_token === "string" ? blocksData.page_token : "";
  }

  return { items, pages };
}

function fetchFeishuPrdSource(prdLink: string, extractMode: FeishuExtractMode = "both"): FeishuPrdSource {
  const appId = readRequiredEnv("AGENTKIT_FEISHU_APP_ID");
  const appSecret = readRequiredEnv("AGENTKIT_FEISHU_APP_SECRET");
  const baseUrl = normalizeFeishuBaseUrl();
  const linkToken = parseFeishuLinkToken(prdLink);

  const authApi = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
  const authPayload = feishuCurlJsonRequest(
    "POST",
    authApi,
    "",
    JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  );
  const authData = parseFeishuData(authPayload, "auth.tenant_access_token");
  const accessToken =
    typeof authData.tenant_access_token === "string"
      ? authData.tenant_access_token
      : typeof authPayload.tenant_access_token === "string"
        ? (authPayload.tenant_access_token as string)
        : "";
  if (!accessToken) {
    throw new AgentKitCliError("Failed to acquire tenant access token from Feishu.");
  }

  const documentToken = resolveFeishuDocxToken(baseUrl, accessToken, linkToken);

  const docApi = `${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}`;
  const docPayload = feishuCurlJsonRequest("GET", docApi, accessToken);
  const docData = parseFeishuData(docPayload, "docx.document");

  let title = "";
  if (typeof docData.title === "string") {
    title = docData.title.trim();
  }
  const documentValue = docData.document;
  if (!title && documentValue && typeof documentValue === "object") {
    const documentRecord = documentValue as Record<string, unknown>;
    if (typeof documentRecord.title === "string") {
      title = documentRecord.title.trim();
    }
  }
  if (!title) {
    title = `PRD-${documentToken}`;
  }

  const rawApi = `${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/raw_content`;
  const rawPayload = feishuCurlJsonRequest("GET", rawApi, accessToken);
  const rawData = parseFeishuData(rawPayload, "docx.raw_content");

  let rawContent = "";
  if (typeof rawData.raw_content === "string") {
    rawContent = rawData.raw_content;
  } else if (typeof rawData.content === "string") {
    rawContent = rawData.content;
  }
  rawContent = normalizeFeishuText(rawContent).trim();

  let richContent = "";
  let richError = "";
  let richPages: Record<string, unknown>[] = [];
  try {
    const richPayload = fetchFeishuDocumentBlocks(baseUrl, accessToken, documentToken);
    richPages = richPayload.pages;
    richContent = renderFeishuBlocksAsMarkdown(documentToken, richPayload.items).trim();
  } catch (error) {
    richError = error instanceof Error ? error.message : String(error);
    richContent = "";
  }

  const richAvailable = richContent.length > 0;
  let content = "";
  if (extractMode === "raw") {
    content = rawContent || richContent;
  } else if (extractMode === "rich") {
    content = richContent || rawContent;
  } else {
    content = richContent || rawContent;
  }

  if (!content) {
    throw new AgentKitCliError("PRD content is empty from Feishu APIs (raw_content and blocks).");
  }

  return {
    title,
    content,
    rawContent,
    richContent,
    richAvailable,
    sourceLink: prdLink,
    documentToken,
    extractMode,
    sourcePayload: {
      source_link: prdLink,
      source_kind: linkToken.kind,
      source_token: linkToken.token,
      document_token: documentToken,
      title,
      extract_mode: extractMode,
      rich_available: richAvailable,
      rich_error: richError || undefined,
      document_payload: docPayload,
      raw_payload: rawPayload,
      blocks_pages: richPages,
    },
  };
}

function stripMarkdownForSentence(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupFeishuBoardMarker(value: string): string {
  const text = stripMarkdownForSentence(value);
  return text.replace(/^Feishu Board:\s*[A-Za-z0-9]+/i, "").trim();
}

function compactHintText(value: string, maxLength: number = 180): string {
  const text = cleanupFeishuBoardMarker(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

type BoardSummaryCandidate = {
  token: string;
  featureHint: string;
  detailHint: string;
};

function extractBoardSummaryCandidates(prdContent: string): BoardSummaryCandidate[] {
  const lines = normalizeFeishuText(prdContent).split("\n");
  const seen = new Set<string>();
  const candidates: BoardSummaryCandidate[] = [];

  const boardTokenRegex = /Feishu Board:\s*([A-Za-z0-9]+)/gi;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("Feishu Board:")) {
      continue;
    }

    const tokens: string[] = [];
    for (const match of line.matchAll(boardTokenRegex)) {
      const token = (match[1] || "").trim();
      if (token && !tokens.includes(token)) {
        tokens.push(token);
      }
    }
    if (tokens.length === 0) {
      continue;
    }

    for (const token of tokens) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);

      let featureHint = "";
      let detailHint = "";

      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("|")) {
        const cols = trimmedLine
          .split("|")
          .slice(1, -1)
          .map((item) => item.trim());
        const boardCellIndex = cols.findIndex((col) => new RegExp(`Feishu Board:\\s*${escapeRegExp(token)}`, "i").test(col));
        if (boardCellIndex >= 0) {
          featureHint = compactHintText(cols[boardCellIndex + 1] || "");
          detailHint = compactHintText(cols[boardCellIndex + 2] || "");
        }
      }

      if (!featureHint || !detailHint) {
        for (let offset = 1; offset <= 3; offset += 1) {
          const nextLine = lines[index + offset];
          if (nextLine) {
            const nextClean = compactHintText(nextLine);
            if (nextClean && !nextClean.includes("Feishu Board:")) {
              if (!featureHint) {
                featureHint = nextClean;
              } else if (!detailHint) {
                detailHint = nextClean;
              }
              if (featureHint && detailHint) {
                break;
              }
            }
          }
        }
      }

      if (!featureHint || !detailHint) {
        for (let offset = 1; offset <= 3; offset += 1) {
          const prevLine = lines[index - offset];
          if (prevLine) {
            const prevClean = compactHintText(prevLine);
            if (prevClean && !prevClean.includes("Feishu Board:")) {
              if (!featureHint) {
                featureHint = prevClean;
              } else if (!detailHint) {
                detailHint = prevClean;
              }
              if (featureHint && detailHint) {
                break;
              }
            }
          }
        }
      }

      candidates.push({
        token,
        featureHint,
        detailHint,
      });
    }
  }

  return candidates;
}

function renderBoardSummaryTemplate(prdContent: string): string {
  const candidates = extractBoardSummaryCandidates(prdContent);
  if (candidates.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("## Board 关键结论摘要（供 Agent 执行）");
  lines.push("");

  for (const candidate of candidates) {
    lines.push(`<a id="${boardAnchorId(candidate.token)}"></a>`);
    lines.push(`### Board: ${candidate.token}`);
    if (candidate.featureHint) {
      lines.push(`- 当前模块：${candidate.featureHint}`);
    }
    if (candidate.detailHint) {
      lines.push(`- 上下文摘录：${candidate.detailHint}`);
    }
    lines.push("- 业务目标：待补充");
    lines.push("- 主流程（3-7步）：待补充");
    lines.push("- 角色与权限：待补充");
    lines.push("- 异常与边界：待补充");
    lines.push("- 后端影响（接口/事件/数据）：待补充");
    lines.push("- 前端影响（页面/组件/状态）：待补充");
    lines.push("- 验收点（可测试）：待补充");
    lines.push("");
  }

  return lines.join("\n").trim();
}

function parsePriorityRowsFromMarkdownTable(prdContent: string, priority: "p0" | "p1"): string[] {
  const rows = prdContent.split("\n");
  const results: string[] = [];
  let lastScenario = "";

  for (const row of rows) {
    const line = row.trim();
    if (!line.startsWith("|") || line.includes("---")) {
      continue;
    }
    const cols = line
      .split("|")
      .slice(1, -1)
      .map((item) => item.trim());
    if (cols.length < 3) {
      continue;
    }
    const priorityCell = cols[cols.length - 1].toLowerCase();
    if (priorityCell !== priority) {
      continue;
    }

    const scenarioRaw = cleanupFeishuBoardMarker(cols[0]);
    if (scenarioRaw) {
      lastScenario = scenarioRaw;
    }
    const scenarioCell = scenarioRaw || lastScenario;
    const featureCell = cleanupFeishuBoardMarker(cols[1]);
    const candidate = scenarioCell && featureCell ? `${scenarioCell}：${featureCell}` : featureCell || scenarioCell;
    if (!candidate || results.includes(candidate)) {
      continue;
    }
    results.push(candidate);
  }

  return results;
}

function extractPrdOverviewSentence(prdContent: string): string {
  const normalized = normalizeFeishuText(prdContent);
  const directMatch = normalized.match(/需求简介[:：]\s*([^\n]+)/);
  if (directMatch?.[1]) {
    return stripMarkdownForSentence(directMatch[1]);
  }

  const lines = normalized.split("\n");
  for (const rawLine of lines) {
    const line = stripMarkdownForSentence(rawLine);
    if (!line) {
      continue;
    }
    if (/^(Requirement Intake|Metadata|Source|PRD Snapshot|PR FAQ|FAQ|目标|需求详细说明)/i.test(line)) {
      continue;
    }
    if (line.startsWith("|") || line.startsWith("TODO")) {
      continue;
    }
    if (line.length < 24) {
      continue;
    }
    return line;
  }

  return "";
}

function renderBullets(lines: string[], fallback: string): string {
  if (lines.length === 0) {
    return `- ${fallback}`;
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function deriveIntakeSummaryAndAcceptance(reqTitle: string, prdContent: string): {
  summaryBullets: string;
  acceptanceBullets: string;
} {
  const summaryLines: string[] = [];
  const acceptanceLines: string[] = [];

  const overview = extractPrdOverviewSentence(prdContent);
  if (overview) {
    summaryLines.push(overview);
  } else {
    summaryLines.push(`本需求围绕「${reqTitle}」推进，详细内容见 PRD 快照。`);
  }

  const p0Items = parsePriorityRowsFromMarkdownTable(prdContent, "p0");
  const p1Items = parsePriorityRowsFromMarkdownTable(prdContent, "p1");

  if (p0Items.length > 0) {
    const highlighted = p0Items.slice(0, 6).join("；");
    summaryLines.push(`本期优先交付 P0 项（共 ${p0Items.length} 项）：${highlighted}。`);
    for (const item of p0Items.slice(0, 8)) {
      acceptanceLines.push(`[P0] ${item} 需实现并可在测试环境稳定演示，评审通过后方可进入下一阶段。`);
    }
  }

  if (p1Items.length > 0) {
    summaryLines.push(`P1 项暂不纳入本次上线范围：${p1Items.slice(0, 5).join("；")}。`);
  }

  if (acceptanceLines.length === 0) {
    acceptanceLines.push("核心流程已跑通，结果与 PRD 的主目标一致。");
    acceptanceLines.push("关键接口、权限与异常路径在测试环境可复现验证。");
    acceptanceLines.push("评审结论明确记录，剩余风险与后续计划已标注。");
  }

  return {
    summaryBullets: renderBullets(summaryLines, "待补充"),
    acceptanceBullets: renderBullets(acceptanceLines, "待补充"),
  };
}

function dedupeKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeMindmapLabel(value: string, maxLength: number = 90): string {
  const text = stripMarkdownForSentence(cleanupFeishuBoardMarker(value))
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "待补充";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

type ExecutableTestCase = {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  type: "正向" | "边界" | "异常" | "回归";
  preconditions: string[];
  steps: string[];
  expected: string[];
};

type ModuleCaseGroup = {
  module: string;
  cases: ExecutableTestCase[];
};

function formatSequentialCaseId(index: number): string {
  return `TC-${String(index).padStart(3, "0")}`;
}

function extractCaseModule(item: string): string {
  const normalized = normalizeMindmapLabel(item, 120);
  const parts = normalized.split(/[：:]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return normalized;
}

function pushMindmapNode(lines: string[], depth: number, label: string, maxLength: number = 150): void {
  lines.push(`${"  ".repeat(depth)}${normalizeMindmapLabel(label, maxLength)}`);
}

function pushExecutableCase(lines: string[], item: ExecutableTestCase, baseDepth: number = 3): void {
  pushMindmapNode(lines, baseDepth, `${item.id} | ${item.title} | ${item.priority} | ${item.type}`, 150);
  pushMindmapNode(lines, baseDepth + 1, "前置条件", 80);
  for (const precondition of item.preconditions) {
    pushMindmapNode(lines, baseDepth + 2, precondition, 170);
  }
  pushMindmapNode(lines, baseDepth + 1, "操作步骤", 80);
  for (const step of item.steps) {
    pushMindmapNode(lines, baseDepth + 2, step, 170);
  }
  pushMindmapNode(lines, baseDepth + 1, "预期结果", 80);
  for (const expected of item.expected) {
    pushMindmapNode(lines, baseDepth + 2, expected, 170);
  }
}

function buildTextNodeLlmRegressionCases(): ExecutableTestCase[] {
  return [
    {
      id: "TC-LLM-001",
      title: "文本节点为空时生成并写入正文",
      priority: "P0",
      type: "正向",
      preconditions: [
        "1) 已登录并进入画布编辑态，存在空白文本节点",
        "2) LLM 模型服务可用",
      ],
      steps: [
        "1) 在 LLM 交互框输入提示词并点击发送",
        "2) 等待模型返回结果",
      ],
      expected: [
        "1) 返回文本自动写入文本节点正文",
        "2) 节点内容状态更新且无报错提示",
      ],
    },
    {
      id: "TC-LLM-002",
      title: "文本节点非空时默认覆盖并可撤销",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 文本节点已有正文内容",
        "2) LLM 模型服务可用",
      ],
      steps: [
        "1) 发送改写提示词触发生成",
        "2) 确认正文被覆盖后执行 Ctrl+Z",
      ],
      expected: [
        "1) 生成结果覆盖原正文",
        "2) 撤销后完整恢复到生成前内容",
      ],
    },
    {
      id: "TC-LLM-003",
      title: "Prompt 拼装顺序符合规则",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 开启请求日志或可观测调试开关",
        "2) 节点已配置上游参考和历史对话",
      ],
      steps: [
        "1) 触发一次 LLM 生成请求",
        "2) 在日志中查看上下文拼装顺序",
      ],
      expected: [
        "1) 顺序为 System -> Context -> NodeContent -> History -> UserPrompt",
        "2) System 与 UserPrompt 未被裁剪",
      ],
    },
    {
      id: "TC-LLM-004",
      title: "上下文超预算按优先级裁剪",
      priority: "P0",
      type: "边界",
      preconditions: [
        "1) 构造超长历史对话与多条上游参考",
        "2) 模型上下文窗口限制可复现",
      ],
      steps: [
        "1) 发起生成请求直到触发超预算",
        "2) 观察提示信息与请求上下文内容",
      ],
      expected: [
        "1) 提示“上下文过长，已自动精简部分参考内容”",
        "2) 裁剪顺序符合规则，优先保留 System 与本次指令",
      ],
    },
    {
      id: "TC-LLM-005",
      title: "会话历史超阈值触发摘要",
      priority: "P1",
      type: "边界",
      preconditions: [
        "1) 同一文本节点已进行多轮对话并超过阈值",
      ],
      steps: [
        "1) 继续发起新一轮生成",
        "2) 检查请求载荷中的历史段落",
      ],
      expected: [
        "1) 历史被压缩为摘要 + 最近若干轮原始对话",
        "2) 摘要包含用户目标与关键约束信息",
      ],
    },
    {
      id: "TC-LLM-006",
      title: "节点记忆隔离",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 画布中存在两个文本节点 A/B",
        "2) A 节点已积累多轮会话历史",
      ],
      steps: [
        "1) 在 B 节点首次发起生成",
        "2) 对比 A/B 请求上下文",
      ],
      expected: [
        "1) B 不携带 A 的历史记忆",
        "2) 节点间会话上下文严格隔离",
      ],
    },
    {
      id: "TC-LLM-007",
      title: "图片参考接入与移除联动",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 存在图片节点与文本节点",
      ],
      steps: [
        "1) 建立图片节点到文本节点的 reference 连线",
        "2) 发起一次生成后断开连线再次生成",
      ],
      expected: [
        "1) 连线后图片参考进入上下文",
        "2) 断线后该参考被移除且不再参与生成",
      ],
    },
    {
      id: "TC-LLM-008",
      title: "文本参考接入与同步更新",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 两个文本节点存在上游 reference 连线",
      ],
      steps: [
        "1) 修改上游文本节点内容",
        "2) 在下游节点发起生成",
      ],
      expected: [
        "1) 下游请求使用最新上游文本作为参考",
        "2) 断开连线后参考文本自动移除",
      ],
    },
    {
      id: "TC-LLM-009",
      title: "模型不支持多模态时降级为 caption",
      priority: "P1",
      type: "异常",
      preconditions: [
        "1) 选择不支持图片输入的文本模型",
        "2) 节点带有图片参考",
      ],
      steps: [
        "1) 发起生成请求",
        "2) 查看请求处理链路或日志",
      ],
      expected: [
        "1) 图片先被转成 caption 文本再注入",
        "2) 请求成功返回且无能力不匹配报错",
      ],
    },
    {
      id: "TC-LLM-010",
      title: "模型失败可重试且保留输入",
      priority: "P0",
      type: "异常",
      preconditions: [
        "1) 模拟模型接口超时或 5xx",
      ],
      steps: [
        "1) 发起生成请求并触发失败",
        "2) 直接点击重试或再次发送",
      ],
      expected: [
        "1) 首次失败给出明确提示，不写回正文",
        "2) 输入框内容保留，重试后可成功生成",
      ],
    },
    {
      id: "TC-LLM-011",
      title: "并发冲突保护",
      priority: "P0",
      type: "异常",
      preconditions: [
        "1) 两个协作者同时编辑同一文本节点",
        "2) 一方在生成中，另一方修改正文",
      ],
      steps: [
        "1) 让生成结果晚于协作者编辑返回",
      ],
      expected: [
        "1) 检测到版本变化后不自动写回",
        "2) 明确提示“内容已更新，请重试”",
      ],
    },
    {
      id: "TC-LLM-012",
      title: "内容安全拦截不写回",
      priority: "P0",
      type: "异常",
      preconditions: [
        "1) 准备会触发安全策略的输入",
      ],
      steps: [
        "1) 发起生成请求",
      ],
      expected: [
        "1) 返回拦截提示，不替换原正文",
        "2) 用户可修改输入后重新尝试",
      ],
    },
    {
      id: "TC-LLM-013",
      title: "局部 AI 编辑仅替换选区",
      priority: "P0",
      type: "回归",
      preconditions: [
        "1) 文本节点存在多段内容并选中局部文本",
      ],
      steps: [
        "1) 点击“ai编辑”并输入修改指令",
        "2) 发送请求并等待返回",
      ],
      expected: [
        "1) 仅选区内容被替换，其它段落保持不变",
        "2) 可通过 Ctrl+Z 撤销本次替换",
      ],
    },
    {
      id: "TC-LLM-014",
      title: "局部编辑超长选区阻断",
      priority: "P1",
      type: "边界",
      preconditions: [
        "1) 选区长度超过 1000 字符",
      ],
      steps: [
        "1) 尝试触发“ai编辑”并发送请求",
      ],
      expected: [
        "1) 阻断请求并提示“选中内容过长，请缩小范围”",
      ],
    },
  ];
}

function deriveTestMindmap(reqTitle: string, prdContent: string): string {
  const p0Items = parsePriorityRowsFromMarkdownTable(prdContent, "p0");
  const p1Items = parsePriorityRowsFromMarkdownTable(prdContent, "p1");
  const scopeItems = dedupeKeepOrder(
    [...p0Items.slice(0, 8), ...p1Items.slice(0, 2)].map((item) => normalizeMindmapLabel(item, 100)),
  );
  if (scopeItems.length === 0) {
    scopeItems.push(`覆盖「${normalizeMindmapLabel(reqTitle, 80)}」主流程联调`);
    scopeItems.push("核心权限与协作链路在测试环境可复现");
    scopeItems.push("主路径验收指标满足 PRD 目标");
  }

  const moduleGroups: ModuleCaseGroup[] = [];
  let caseSeq = 1;
  for (const scopeItem of scopeItems) {
    const moduleLabel = extractCaseModule(scopeItem);
    const group: ModuleCaseGroup = {
      module: moduleLabel,
      cases: [],
    };
    group.cases.push({
      id: formatSequentialCaseId(caseSeq),
      title: `${moduleLabel} 主流程可达`,
      priority: "P0",
      type: "正向",
      preconditions: [
        "1) 准备可用测试账号并具备对应权限",
        `2) 准备基础数据，覆盖模块：${moduleLabel}`,
      ],
      steps: [
        `1) 进入模块入口并定位到「${moduleLabel}」`,
        "2) 按 PRD 主链路完成关键操作",
        "3) 提交并等待页面与接口返回",
      ],
      expected: [
        "1) 主流程执行成功，无阻断错误",
        "2) 页面状态与数据落库结果一致",
        "3) 关键埋点事件可检索",
      ],
    });
    caseSeq += 1;

    group.cases.push({
      id: formatSequentialCaseId(caseSeq),
      title: `${moduleLabel} 边界值处理`,
      priority: "P1",
      type: "边界",
      preconditions: [
        `1) 已进入「${moduleLabel}」并准备边界数据（空值/上限/下限）`,
      ],
      steps: [
        "1) 依次输入边界数据并执行核心动作",
        "2) 观察交互提示与状态变化",
      ],
      expected: [
        "1) 非法边界被阻断并提示明确原因",
        "2) 合法边界可正常提交并结果正确",
      ],
    });
    caseSeq += 1;

    group.cases.push({
      id: formatSequentialCaseId(caseSeq),
      title: `${moduleLabel} 异常回滚与重试`,
      priority: "P0",
      type: "异常",
      preconditions: [
        `1) 已进入「${moduleLabel}」并可触发请求`,
        "2) 可注入网络超时或 5xx 异常",
      ],
      steps: [
        "1) 触发操作并模拟接口失败",
        "2) 观察页面提示后执行重试",
      ],
      expected: [
        "1) 失败时界面状态可回滚且不产生脏数据",
        "2) 重试成功后流程恢复并可继续操作",
      ],
    });
    caseSeq += 1;
    moduleGroups.push(group);
  }

  const includesTextNodeLlm = /(文本节点)/i.test(prdContent) && /(llm|大模型)/i.test(prdContent);
  const llmCases = includesTextNodeLlm ? buildTextNodeLlmRegressionCases() : [];
  if (llmCases.length > 0) {
    const llmGroupIndex = moduleGroups.findIndex((group) => /(文本节点|llm|画布新增能力)/i.test(group.module));
    if (llmGroupIndex >= 0) {
      moduleGroups[llmGroupIndex].cases.push(...llmCases);
    } else {
      moduleGroups.push({
        module: "文本节点接入LLM专项",
        cases: llmCases,
      });
    }
  }

  const lines: string[] = [];
  lines.push("mindmap");
  lines.push(`  root((${normalizeMindmapLabel(reqTitle, 100)} 可执行测试用例))`);
  lines.push("    执行规范");
  lines.push("      用例节点格式：用例ID | 标题 | 优先级 | 类型");
  lines.push("      每条用例必须包含：前置条件 -> 操作步骤 -> 预期结果");
  lines.push("      输出顺序：按功能模块分组 -> 模块内可执行用例");
  lines.push("      回归执行建议：先跑P0正向，再跑P0异常，最后补充P1边界");
  lines.push("    按功能模块分组");
  for (const group of moduleGroups) {
    pushMindmapNode(lines, 3, `模块：${group.module}`, 140);
    for (const item of group.cases) {
      pushExecutableCase(lines, item, 4);
    }
  }

  return `${lines.join("\n")}\n`;
}

function normalizeTagSet(tags: string[]): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function loadContextIndex(indexFile: string): ContextIndexFile {
  if (!existsSync(indexFile)) {
    return { entries: [] };
  }
  const raw = readFileSync(indexFile, "utf8");
  try {
    const parsed = JSON.parse(raw) as ContextIndexFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    const normalizedEntries = parsed.entries.map((entry) => ({
      ...entry,
      tags: Array.isArray(entry.tags) ? normalizeTagSet(entry.tags) : [],
      stage: entry.stage || "unknown",
      domain: entry.domain || "general",
      status: entry.status || "draft",
      hit_count:
        typeof entry.hit_count === "number" && Number.isFinite(entry.hit_count)
          ? Math.max(0, Math.floor(entry.hit_count))
          : 0,
      last_hit_at: typeof entry.last_hit_at === "string" ? entry.last_hit_at : undefined,
      evolution_candidate:
        Object.prototype.hasOwnProperty.call(entry, "evolution_candidate")
          ? entry.evolution_candidate
          : undefined,
    }));
    return { ...parsed, entries: normalizedEntries };
  } catch {
    return { entries: [] };
  }
}

function isRiskContextEntry(entry: ContextIndexEntry): boolean {
  const hasRiskTag = entry.tags.some((tag) => tag.toLowerCase() === "risk");
  if (hasRiskTag) {
    return true;
  }
  const probe = `${entry.path} ${entry.title}`.toLowerCase();
  return probe.includes("risk");
}

function estimateContextEntryTokens(entry: ContextIndexEntry): number {
  const raw = `${entry.id}|${entry.title}|${entry.tags.join(",")}|${entry.path}`;
  return 16 + Math.ceil(raw.length / 4);
}

function selectContextEntries(entries: ContextIndexEntry[], query: ContextQuery): ContextSelectionResult {
  const tagSet = new Set(normalizeTagSet(query.tags));
  const scored = entries
    .map((entry) => {
      let score = 0;
      if (query.stage && entry.stage.toLowerCase() === query.stage.toLowerCase()) {
        score += 3;
      }
      if (query.domain && entry.domain.toLowerCase() === query.domain.toLowerCase()) {
        score += 2;
      }
      if (entry.status.toLowerCase() === "verified") {
        score += 1;
      }
      const entryTags = normalizeTagSet(entry.tags);
      for (const tag of entryTags) {
        if (tagSet.has(tag)) {
          score += 1;
        }
      }
      const hitCount = typeof entry.hit_count === "number" ? entry.hit_count : 0;
      return {
        entry,
        score,
        risk: isRiskContextEntry(entry),
        hitCount,
        estimatedTokens: estimateContextEntryTokens(entry),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (a.risk !== b.risk) {
        return a.risk ? -1 : 1;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.hitCount !== b.hitCount) {
        return b.hitCount - a.hitCount;
      }
      return a.entry.path.localeCompare(b.entry.path);
    });

  const selected: ContextIndexEntry[] = [];
  let estimatedTokens = 0;
  let droppedByBudget = 0;
  for (const item of scored) {
    if (selected.length >= query.limit) {
      break;
    }
    const nextTokens = estimatedTokens + item.estimatedTokens;
    const exceedsBudget = selected.length > 0 && nextTokens > query.maxTokens;
    if (exceedsBudget) {
      droppedByBudget += 1;
      continue;
    }
    selected.push(item.entry);
    estimatedTokens = nextTokens;
  }

  const matchedTotal = scored.length;
  const droppedByLimit = Math.max(0, matchedTotal - selected.length - droppedByBudget);
  return {
    selected,
    matched_total: matchedTotal,
    dropped_by_limit: droppedByLimit,
    dropped_by_budget: droppedByBudget,
    estimated_tokens: estimatedTokens,
  };
}

function compactContextCell(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function updateContextEntryHitCount(indexFile: string, selected: ContextIndexEntry[]): void {
  if (!existsSync(indexFile) || selected.length === 0) {
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(indexFile, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!Array.isArray(parsed.entries)) {
    return;
  }
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  const now = agentkitTimestampUtc();

  let changed = false;
  const updatedEntries = parsed.entries.map((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== "object") {
      return rawEntry;
    }
    const entry = rawEntry as Record<string, unknown>;
    const entryId = typeof entry.id === "string" ? entry.id : "";
    const entryPath = typeof entry.path === "string" ? entry.path : "";
    if (!selectedIds.has(entryId) && !selectedPaths.has(entryPath)) {
      return rawEntry;
    }
    const previousHitCount =
      typeof entry.hit_count === "number" && Number.isFinite(entry.hit_count)
        ? Math.max(0, Math.floor(entry.hit_count))
        : 0;
    changed = true;
    return {
      ...entry,
      hit_count: previousHitCount + 1,
      last_hit_at: now,
    };
  });

  if (!changed) {
    return;
  }
  parsed.entries = updatedEntries;
  writeFileSync(indexFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function renderContextSelectionMarkdown(
  indexPath: string,
  query: ContextQuery,
  selection: ContextSelectionResult,
): string {
  const lines: string[] = [];
  lines.push("## Retrieved Context");
  lines.push("");
  lines.push(`- Index: ${indexPath}`);
  lines.push(`- Stage: ${query.stage || "N/A"}`);
  lines.push(`- Domain: ${query.domain || "N/A"}`);
  lines.push(`- Tags: ${query.tags.length > 0 ? query.tags.join(", ") : "N/A"}`);
  lines.push(`- Limit: ${query.limit}`);
  lines.push(`- Budget: ${query.budgetLevel.toUpperCase()} (${query.maxTokens} tokens est.)`);
  lines.push(
    `- Match/Select: ${selection.matched_total}/${selection.selected.length} (dropped: limit=${selection.dropped_by_limit}, budget=${selection.dropped_by_budget})`,
  );
  lines.push(`- Estimated Tokens: ${selection.estimated_tokens}`);
  lines.push("");

  if (selection.selected.length === 0) {
    lines.push("- No matched context assets. Consider running context indexing or broadening query tags.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| # | ID | Title | Tags | Risk | Path |");
  lines.push("|---|---|---|---|---|---|");
  for (let index = 0; index < selection.selected.length; index += 1) {
    const item = selection.selected[index];
    const tagsText = item.tags.length > 0 ? compactContextCell(item.tags.join(","), 36) : "N/A";
    const riskText = isRiskContextEntry(item) ? "⚠ RISK" : "-";
    lines.push(
      `| ${index + 1} | ${compactContextCell(item.id, 28)} | ${compactContextCell(item.title, 42)} | ${tagsText} | ${riskText} | ${compactContextCell(item.path, 56)} |`,
    );
  }
  lines.push("");
  lines.push("> 仅返回元信息；如需细节请按 Path 读取原文。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function maybeRebuildContextIndex(root: string): void {
  const scriptPath = join(root, "scripts", "build-index.mjs");
  if (!existsSync(scriptPath)) {
    return;
  }
  const run = runCommand(
    "node",
    [scriptPath],
    { cwd: root, allowFailure: true },
  );
  if (run.status !== 0) {
    agentkitWarn("Failed to rebuild context index automatically. Run 'node scripts/build-index.mjs' manually.");
  }
}

function ensureSpeckitLiteStructure(root: string): void {
  mkdirSync(join(root, "requirements", "in-progress"), { recursive: true });
  mkdirSync(join(root, "requirements", "completed"), { recursive: true });
  mkdirSync(join(root, "requirements", "archive"), { recursive: true });
  mkdirSync(join(root, "context", "business"), { recursive: true });
  mkdirSync(join(root, "context", "records", "experience"), { recursive: true });

  const agentsFile = join(root, "AGENTS.md");
  if (!existsSync(agentsFile)) {
    writeFileSync(
      agentsFile,
      `# AGENTS

This repository uses a requirement-first workflow for Cursor agents.

## Required Inputs

- Read requirement packet under \`requirements/in-progress/<requirement-id>/\`.
- Use repo links from \`requirements/repo-links.yml\` (frontend/backend).
- Pull reusable facts from \`context/index.json\`.

## Delivery Rules

- Keep technical decisions in \`02-technical-solution.md\`.
- Keep API changes in \`03-api-design.md\`.
- Keep execution split in \`06-task-assignment.yaml\`.
- Write reusable learnings with \`agentkit optimize-flow\`.
`,
      "utf8",
    );
    agentkitInfo("Wrote guide: AGENTS.md");
  }

  const indexFile = join(root, "requirements", "INDEX.md");
  if (!existsSync(indexFile)) {
    writeFileSync(
      indexFile,
      `# Requirements Index

## In Progress

## Completed
`,
      "utf8",
    );
    agentkitInfo("Wrote guide: requirements/INDEX.md");
  }

  const repoLinksFile = join(root, "requirements", "repo-links.yml");
  if (!existsSync(repoLinksFile)) {
    writeFileSync(
      repoLinksFile,
      renderRepoLinksYaml({
        frontend: "https://git.example.com/frontend.git",
        backend: "https://git.example.com/backend.git",
      }),
      "utf8",
    );
    agentkitInfo("Wrote guide: requirements/repo-links.yml");
  }

  const businessReadme = join(root, "context", "business", "README.md");
  if (!existsSync(businessReadme)) {
    writeFileSync(
      businessReadme,
      `# Business Context

沉淀可跨需求复用的业务规则与领域知识（例如优惠券、虚拟商品、支付等）。

建议每条业务知识采用 frontmatter，并保证可被 \`scripts/build-index.mjs\` 检索：

\`\`\`md
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
\`\`\`
`,
      "utf8",
    );
    agentkitInfo("Wrote guide: context/business/README.md");
  }
}

function parseRepoLinksYaml(content: string): RepoLinks {
  const links: RepoLinks = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9._-]+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    let value = match[2].trim();
    value = value.replace(/^["']/, "").replace(/["']$/, "").trim();
    if (!key || !value) {
      continue;
    }
    links[key] = value;
  }
  return links;
}

function renderRepoLinksYaml(links: RepoLinks): string {
  const keys = Object.keys(links).sort((a, b) => a.localeCompare(b));
  const lines = keys.map((key) => `${key}: "${links[key]}"`);
  return `${lines.join("\n")}\n`;
}

function readRepoLinks(repoLinksFile: string): RepoLinks {
  const fallback: RepoLinks = {
    frontend: "https://git.example.com/frontend.git",
    backend: "https://git.example.com/backend.git",
  };
  if (!existsSync(repoLinksFile)) {
    return fallback;
  }
  const content = readFileSync(repoLinksFile, "utf8");
  const parsed = parseRepoLinksYaml(content);
  if (Object.keys(parsed).length === 0) {
    return fallback;
  }
  return parsed;
}

function writeRepoLinks(repoLinksFile: string, links: RepoLinks): void {
  writeFileSync(repoLinksFile, renderRepoLinksYaml(links), "utf8");
}

function withRepoOverrides(base: RepoLinks, frontendRepo: string, backendRepo: string): RepoLinks {
  const merged: RepoLinks = { ...base };
  if (frontendRepo) {
    merged.frontend = frontendRepo;
  }
  if (backendRepo) {
    merged.backend = backendRepo;
  }
  return merged;
}

function pickBackendRepoEntry(links: RepoLinks): [string, string] | null {
  if (links.backend) {
    return ["backend", links.backend];
  }
  const entries = Object.entries(links);
  const byName = entries.find(([key]) => /backend|be/i.test(key));
  if (byName) {
    return byName;
  }
  return null;
}

function pickFrontendRepoEntries(links: RepoLinks, backendKey: string | null): Array<[string, string]> {
  return Object.entries(links)
    .filter(([key]) => key !== backendKey)
    .filter(([, value]) => value.trim().length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function buildDefaultTaskTemplates(reqId: string, owner: string, domain: string, tsUtc: string, repoLinks: RepoLinks): {
  breakdownYaml: string;
  assignmentYaml: string;
  deliveryMd: string;
} {
  const backendEntry = pickBackendRepoEntry(repoLinks);
  const frontendEntries = pickFrontendRepoEntries(repoLinks, backendEntry?.[0] || null);

  const taskRows: Array<{ id: string; title: string; role: string; dependsOn: string[]; repoKey: string; repoUrl: string }> = [];
  let sequence = 1;

  if (backendEntry) {
    const [repoKey, repoUrl] = backendEntry;
    const taskId = `TASK-${String(sequence).padStart(3, "0")}`;
    taskRows.push({
      id: taskId,
      title: "Backend implementation",
      role: "backend",
      dependsOn: [],
      repoKey,
      repoUrl,
    });
    sequence += 1;
  }

  for (const [repoKey, repoUrl] of frontendEntries) {
    const taskId = `TASK-${String(sequence).padStart(3, "0")}`;
    taskRows.push({
      id: taskId,
      title: `Frontend implementation (${repoKey})`,
      role: "frontend",
      dependsOn: backendEntry ? [taskRows[0].id] : [],
      repoKey,
      repoUrl,
    });
    sequence += 1;
  }

  if (taskRows.length === 0) {
    const fallbackEntry = Object.entries(repoLinks)[0] || ["repo", "https://git.example.com/repo.git"];
    taskRows.push({
      id: "TASK-001",
      title: "Implementation",
      role: "fullstack",
      dependsOn: [],
      repoKey: fallbackEntry[0],
      repoUrl: fallbackEntry[1],
    });
  }

  const breakdownTasks = taskRows
    .map((task) => {
      const deps = task.dependsOn.length > 0 ? `[${task.dependsOn.join(", ")}]` : "[]";
      return `  - id: ${task.id}
    title: "${task.title}"
    role: ${task.role}
    depends_on: ${deps}`;
    })
    .join("\n");
  const breakdownYaml = `meta:
  requirement_id: "${reqId}"
  owner: "${owner}"
  domain: "${domain}"
  updated_at: "${tsUtc}"
tasks:
${breakdownTasks}
`;

  const repoYaml = Object.entries(repoLinks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `  ${key}: "${value}"`)
    .join("\n");
  const assignmentRows = taskRows
    .map((task) => {
      const docs = task.role === "frontend"
        ? '["02-technical-solution.md", "03-api-design.md", "04-ui-handoff.md"]'
        : '["02-technical-solution.md", "03-api-design.md"]';
      return `  - task_id: ${task.id}
    repo: "${task.repoUrl}"
    assignee: "${task.repoKey}-owner"
    input_docs: ${docs}`;
    })
    .join("\n");
  const assignmentYaml = `meta:
  requirement_id: "${reqId}"
  updated_at: "${tsUtc}"
repos:
${repoYaml}
assignments:
${assignmentRows}
`;

  const prLinkLines = Object.entries(repoLinks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key]) => `- ${key} PR: TODO`)
    .join("\n");
  const deliveryMd = `# Delivery

## PR Links

${prLinkLines || "- PR: TODO"}

## Validation

- Unit tests: TODO
- Integration tests: TODO
- Regression tests: TODO

## Release and Rollback

- TODO
`;

  return {
    breakdownYaml,
    assignmentYaml,
    deliveryMd,
  };
}

function isRequirementPhaseKey(value: string): value is RequirementPhaseKey {
  return Object.prototype.hasOwnProperty.call(REQUIREMENT_PHASE_BLUEPRINTS, value);
}

function readRequirementStateFromIndex(indexFile: string, requirementId: string): RequirementState | null {
  if (!existsSync(indexFile)) {
    return null;
  }
  const content = readFileSync(indexFile, "utf8");
  const pattern = new RegExp(`^- ${escapeRegExp(requirementId)} \\|.*$`, "m");
  const match = content.match(pattern);
  if (!match) {
    return null;
  }
  const statePart = match[0]
    .split("|")
    .map((item) => item.trim())
    .find((item) => item.startsWith("state="));
  if (!statePart) {
    return null;
  }
  const state = statePart.slice("state=".length).trim();
  return isRequirementState(state) ? state : null;
}

function listTaskInputFiles(requirementDir: string): string[] {
  if (!existsSync(requirementDir)) {
    return [];
  }
  return readdirSync(requirementDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^task-input-.*\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readApprovedReviewFile(requirementDir: string, fileName: ".review-intake.json" | ".review-design.json"): boolean {
  const filePath = join(requirementDir, fileName);
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.approved === true;
  } catch {
    return false;
  }
}

function readRequirementArtifact(requirementDir: string, fileName: string): string {
  const filePath = join(requirementDir, fileName);
  if (!existsSync(filePath)) {
    return "";
  }
  return readFileSync(filePath, "utf8");
}

function hasTodoPlaceholder(content: string): boolean {
  return /\bTODO\b/i.test(content);
}

function countMindmapLeafNodes(content: string): number {
  const lines = content.split(/\r?\n/);
  let count = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^(mindmap|root\(\(|Core Paths|Edge Cases|Exception Flows)\b/i.test(line)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function hasExecutableTestCaseStructure(content: string): boolean {
  const requiredSections = ["前置条件", "操作步骤", "预期结果"];
  if (!requiredSections.every((section) => content.includes(section))) {
    return false;
  }
  return /(TC-\d{3}|TC-LLM-\d{3})/.test(content);
}

function isMeaningfulRequirementOutput(requirementDir: string, outputName: string): boolean {
  const content = readRequirementArtifact(requirementDir, outputName);
  if (!content.trim()) {
    return false;
  }

  if (outputName === "01-test-cases.mmd") {
    if (hasExecutableTestCaseStructure(content)) {
      return !hasTodoPlaceholder(content) && countMindmapLeafNodes(content) >= 12;
    }
    return !hasTodoPlaceholder(content) && countMindmapLeafNodes(content) >= 3;
  }
  if (outputName === "02-technical-solution.md") {
    return !hasTodoPlaceholder(content) && /##\s+Architecture/i.test(content) && /##\s+Tradeoffs and Risks/i.test(content);
  }
  if (outputName === "03-api-design.yaml") {
    const hasRealPath = /paths:\s*\n\s*\/\S+:\s*/m.test(content);
    return hasRealPath;
  }
  if (outputName === "03-api-design.md") {
    return !hasTodoPlaceholder(content) && /Endpoint\/Topic:\s*(?!TODO\b).+/i.test(content);
  }
  if (outputName === "04-ui-handoff.md") {
    return !hasTodoPlaceholder(content) && /##\s+UI State Mapping/i.test(content);
  }

  return true;
}

function requirementOutputSatisfied(requirementDir: string, outputName: string): boolean {
  if (outputName === "task-input-*.md") {
    return listTaskInputFiles(requirementDir).length > 0;
  }
  if (!existsSync(join(requirementDir, outputName))) {
    return false;
  }
  if (outputName === "01-test-cases.mmd") {
    return isMeaningfulRequirementOutput(requirementDir, outputName);
  }
  if (outputName === "02-technical-solution.md") {
    return isMeaningfulRequirementOutput(requirementDir, outputName);
  }
  if (outputName === "03-api-design.yaml") {
    return isMeaningfulRequirementOutput(requirementDir, outputName);
  }
  if (outputName === "03-api-design.md") {
    return isMeaningfulRequirementOutput(requirementDir, outputName);
  }
  if (outputName === "04-ui-handoff.md") {
    return isMeaningfulRequirementOutput(requirementDir, outputName);
  }
  return true;
}

function collectOutputStatus(requirementDir: string, outputs: string[]): { completed: string[]; pending: string[] } {
  const completed: string[] = [];
  const pending: string[] = [];
  for (const output of outputs) {
    if (requirementOutputSatisfied(requirementDir, output)) {
      completed.push(output);
    } else {
      pending.push(output);
    }
  }
  return { completed, pending };
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function resolveRequirementRoutePhase(
  requirementDir: string,
  indexedState: RequirementState | null,
): { phase: RequirementPhaseKey; state: RequirementState } {
  const has00 = requirementOutputSatisfied(requirementDir, "00-intake.md");
  const has01 = requirementOutputSatisfied(requirementDir, "01-test-cases.mmd");
  const has02 = requirementOutputSatisfied(requirementDir, "02-technical-solution.md");
  const has03Yaml = requirementOutputSatisfied(requirementDir, "03-api-design.yaml");
  const has03Md = requirementOutputSatisfied(requirementDir, "03-api-design.md");
  const has04 = requirementOutputSatisfied(requirementDir, "04-ui-handoff.md");
  const has05 = requirementOutputSatisfied(requirementDir, "05-task-breakdown.yaml");
  const has06 = requirementOutputSatisfied(requirementDir, "06-task-assignment.yaml");
  const has07 = requirementOutputSatisfied(requirementDir, "07-delivery.md");
  const has08 = requirementOutputSatisfied(requirementDir, "08-retro.md");
  const hasTaskInput = listTaskInputFiles(requirementDir).length > 0;
  const intakeApproved = readApprovedReviewFile(requirementDir, ".review-intake.json");
  const designApproved = readApprovedReviewFile(requirementDir, ".review-design.json");

  if (!has00 || !has01) {
    return { phase: "intake", state: "draft" };
  }
  if (!intakeApproved) {
    return { phase: "review-intake", state: "draft" };
  }
  if (!has02 || !has03Yaml || !has03Md || !has04) {
    return { phase: "design", state: "intake-reviewed" };
  }
  if (!designApproved) {
    return { phase: "review-design", state: "design" };
  }
  if (!has05 || !has06) {
    return { phase: "breakdown", state: "design-reviewed" };
  }
  if (!hasTaskInput || !has07) {
    return { phase: "task-input-gen", state: "design-reviewed" };
  }

  if (indexedState === "archived") {
    return { phase: "archive", state: "archived" };
  }
  if (indexedState === "completed") {
    return { phase: "archive", state: "completed" };
  }
  if (indexedState === "validating") {
    return { phase: "completion", state: "validating" };
  }
  if (indexedState === "implementing") {
    return { phase: "validation", state: "implementing" };
  }
  if (!has08) {
    return { phase: "validation", state: "implementing" };
  }
  return { phase: "completion", state: "validating" };
}

function buildRequirementRouteDecision(
  requirementDir: string,
  indexedState: RequirementState | null,
): RequirementRouteDecision {
  const { phase, state } = resolveRequirementRoutePhase(requirementDir, indexedState);
  const blueprint = REQUIREMENT_PHASE_BLUEPRINTS[phase];
  const outputStatus = collectOutputStatus(requirementDir, blueprint.required_outputs);
  return {
    state,
    phase,
    outputs_completed: outputStatus.completed,
    outputs_pending: outputStatus.pending,
  };
}

function sessionRouteHash(reqId: string, phase: RequirementPhaseKey, pending: string[]): string {
  return createHash("sha256")
    .update(`${reqId}|${phase}|${pending.join(",")}`)
    .digest("hex")
    .slice(0, 8);
}

function readRequirementSessionState(sessionFile: string): RequirementSessionState | null {
  if (!existsSync(sessionFile)) {
    return null;
  }
  try {
    const raw = readFileSync(sessionFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const phaseRaw = typeof parsed.current_phase === "string" ? parsed.current_phase : "";
    const statusRaw = typeof parsed.status === "string" ? parsed.status : "";
    if (!isRequirementPhaseKey(phaseRaw)) {
      return null;
    }
    if (statusRaw !== "in_progress" && statusRaw !== "completed" && statusRaw !== "failed") {
      return null;
    }
    return {
      req_id: typeof parsed.req_id === "string" ? parsed.req_id : "",
      current_phase: phaseRaw,
      owner_agent: typeof parsed.owner_agent === "string" ? parsed.owner_agent : "",
      required_skills: Array.isArray(parsed.required_skills)
        ? parsed.required_skills.filter((item): item is string => typeof item === "string")
        : [],
      retrieved_context_hash: typeof parsed.retrieved_context_hash === "string" ? parsed.retrieved_context_hash : "",
      status: statusRaw,
      outputs_completed: Array.isArray(parsed.outputs_completed)
        ? parsed.outputs_completed.filter((item): item is string => typeof item === "string")
        : [],
      outputs_pending: Array.isArray(parsed.outputs_pending)
        ? parsed.outputs_pending.filter((item): item is string => typeof item === "string")
        : [],
      last_gate_result: parsed.last_gate_result === "PASS" || parsed.last_gate_result === "FAIL" ? parsed.last_gate_result : null,
      last_error: typeof parsed.last_error === "string" ? parsed.last_error : null,
      started_at: typeof parsed.started_at === "string" ? parsed.started_at : agentkitTimestampUtc(),
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : agentkitTimestampUtc(),
    };
  } catch {
    return null;
  }
}

function writeRequirementSessionState(sessionFile: string, state: RequirementSessionState): void {
  writeFileSync(sessionFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function refreshInProgressSession(
  session: RequirementSessionState,
  requirementDir: string,
): RequirementSessionState {
  const completedNow = session.outputs_pending.filter((output) => requirementOutputSatisfied(requirementDir, output));
  const stillPending = session.outputs_pending.filter((output) => !requirementOutputSatisfied(requirementDir, output));
  return {
    ...session,
    outputs_completed: dedupeAndSort([...session.outputs_completed, ...completedNow]),
    outputs_pending: dedupeAndSort(stillPending),
    status: stillPending.length > 0 ? "in_progress" : "completed",
    updated_at: agentkitTimestampUtc(),
  };
}

function nextGateCommandForPhase(reqId: string, phase: RequirementPhaseKey): string {
  if (phase === "validation") {
    return `agentkit req-dev --id ${reqId} --transition implementing:validating --check-only`;
  }
  if (phase === "completion") {
    return `agentkit req-dev --id ${reqId} --transition validating:completed --check-only`;
  }
  if (phase === "archive") {
    return `agentkit req-dev --id ${reqId} --transition completed:archived --check-only`;
  }
  return "";
}

function handleRequirementSessionRouting(root: string, requirementId: string): void {
  const reqLookup = findRequirementDir(root, requirementId);
  const reqDir = reqLookup.dir;
  const reqRelDir = reqLookup.relDir;
  const sessionFile = join(reqDir, ".session-state.json");
  const existingSession = readRequirementSessionState(sessionFile);

  if (existingSession && existingSession.req_id && existingSession.req_id !== requirementId) {
    agentkitWarn(`Session req_id mismatch in ${relative(root, sessionFile)}. Rewriting with current requirement id.`);
  }

  if (existingSession?.status === "in_progress") {
    const refreshed = refreshInProgressSession(existingSession, reqDir);
    if (refreshed.outputs_pending.length > 0) {
      const indexedStateForRefresh = readRequirementStateFromIndex(join(root, "requirements", "INDEX.md"), requirementId);
      const refreshedDecision = buildRequirementRouteDecision(reqDir, indexedStateForRefresh);
      const oldPending = dedupeAndSort(refreshed.outputs_pending);
      const newPending = dedupeAndSort(refreshedDecision.outputs_pending);
      const routeChanged =
        refreshed.current_phase !== refreshedDecision.phase || oldPending.join(",") !== newPending.join(",");

      if (!routeChanged) {
        if (refreshed.current_phase === "design") {
          const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
          const missingContexts = collectMissingServiceContexts(root, repoLinks);
          if (missingContexts.length > 0) {
            const errorMessage = `Missing service context: ${missingContexts.map((item) => item.repoKey).join(", ")}`;
            const failedSession: RequirementSessionState = {
              ...refreshed,
              status: "failed",
              last_error: errorMessage,
              updated_at: agentkitTimestampUtc(),
            };
            writeRequirementSessionState(sessionFile, failedSession);
            agentkitWarn(errorMessage);
            for (const item of missingContexts) {
              agentkitWarn(
                `Run: agentkit load-service ${item.repoUrl ? shellEscape(item.repoUrl) : "<repo-url-or-path>"} --name ${item.suggestedServiceName}`,
              );
            }
            agentkitInfo(`Session paused: ${relative(root, sessionFile)}`);
            return;
          }
        }
        writeRequirementSessionState(sessionFile, refreshed);
        agentkitInfo(`Resumed in-progress session: ${relative(root, sessionFile)}`);
        agentkitInfo(`Phase: ${refreshed.current_phase} | Owner: ${refreshed.owner_agent}`);
        agentkitInfo(`Pending outputs: ${refreshed.outputs_pending.join(", ")}`);
        return;
      }
      agentkitInfo(
        `Session route updated: phase ${refreshed.current_phase} -> ${refreshedDecision.phase}; pending ${oldPending.join(",")} -> ${newPending.join(",")}`,
      );
    }
  }

  if (existingSession?.status === "failed" && existingSession.last_error) {
    agentkitWarn(`Last session failed: ${existingSession.last_error}`);
  }

  const indexedState = readRequirementStateFromIndex(join(root, "requirements", "INDEX.md"), requirementId);
  let routeDecision = buildRequirementRouteDecision(reqDir, indexedState);
  if (routeDecision.phase === "design") {
    const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
    const missingContexts = collectMissingServiceContexts(root, repoLinks);
    if (missingContexts.length > 0) {
      const errorMessage = `Missing service context: ${missingContexts.map((item) => item.repoKey).join(", ")}`;
      const now = agentkitTimestampUtc();
      const pausedSession: RequirementSessionState = {
        req_id: requirementId,
        current_phase: routeDecision.phase,
        owner_agent: REQUIREMENT_PHASE_BLUEPRINTS.design.owner_agent,
        required_skills: REQUIREMENT_PHASE_BLUEPRINTS.design.required_skills,
        retrieved_context_hash: sessionRouteHash(requirementId, routeDecision.phase, routeDecision.outputs_pending),
        status: "failed",
        outputs_completed: dedupeAndSort(routeDecision.outputs_completed),
        outputs_pending: dedupeAndSort(routeDecision.outputs_pending),
        last_gate_result: existingSession?.last_gate_result || null,
        last_error: errorMessage,
        started_at: existingSession?.started_at || now,
        updated_at: now,
      };
      writeRequirementSessionState(sessionFile, pausedSession);
      agentkitWarn(errorMessage);
      for (const item of missingContexts) {
        agentkitWarn(
          `Run: agentkit load-service ${item.repoUrl ? shellEscape(item.repoUrl) : "<repo-url-or-path>"} --name ${item.suggestedServiceName}`,
        );
      }
      agentkitInfo(`Session paused: ${relative(root, sessionFile)}`);
      return;
    }
  }
  if (routeDecision.phase === "task-input-gen" && routeDecision.outputs_pending.includes("task-input-*.md")) {
    const generated = generateTaskInputArtifacts(root, requirementId, reqDir);
    for (const file of generated.generated_files) {
      agentkitInfo(`Generated task input: ${relative(root, join(reqDir, file))}`);
    }
    if (generated.delivery_updated) {
      agentkitInfo(`Updated delivery tracking: ${relative(root, join(reqDir, "07-delivery.md"))}`);
    }
    for (const warning of generated.warnings) {
      agentkitWarn(warning);
    }
    routeDecision = buildRequirementRouteDecision(reqDir, indexedState);
  }

  if (listTaskInputFiles(reqDir).length > 0) {
    const missingWorkspaces = collectMissingRequirementWorkspaces(root, reqDir);
    if (missingWorkspaces.length > 0) {
      const errorMessage = missingRequirementWorkspaceMessage(missingWorkspaces);
      const blueprint = REQUIREMENT_PHASE_BLUEPRINTS[routeDecision.phase];
      const pausedAt = agentkitTimestampUtc();
      const pausedSession: RequirementSessionState = {
        req_id: requirementId,
        current_phase: routeDecision.phase,
        owner_agent: blueprint.owner_agent,
        required_skills: blueprint.required_skills,
        retrieved_context_hash: sessionRouteHash(requirementId, routeDecision.phase, routeDecision.outputs_pending),
        status: "failed",
        outputs_completed: dedupeAndSort(routeDecision.outputs_completed),
        outputs_pending: dedupeAndSort(routeDecision.outputs_pending),
        last_gate_result: existingSession?.last_gate_result || null,
        last_error: errorMessage,
        started_at: existingSession?.started_at || pausedAt,
        updated_at: pausedAt,
      };
      writeRequirementSessionState(sessionFile, pausedSession);
      agentkitWarn(errorMessage);
      logMissingRequirementWorkspaces(missingWorkspaces);
      agentkitInfo(`Session paused: ${relative(root, sessionFile)}`);
      return;
    }
    warnOnRequirementWorkspaceBindings(root, reqDir);
    const dispatchResult = writeSubAgentDispatchArtifacts(root, requirementId, reqDir);
    agentkitInfo(`Generated dispatch plan: ${relative(root, dispatchResult.markdown_path)}`);
    agentkitInfo(`Generated dispatch script: ${relative(root, dispatchResult.script_path)}`);
    for (const warning of dispatchResult.warnings) {
      agentkitWarn(warning);
    }
  }

  const blueprint = REQUIREMENT_PHASE_BLUEPRINTS[routeDecision.phase];
  const now = agentkitTimestampUtc();
  const updatedSession: RequirementSessionState = {
    req_id: requirementId,
    current_phase: routeDecision.phase,
    owner_agent: blueprint.owner_agent,
    required_skills: blueprint.required_skills,
    retrieved_context_hash: sessionRouteHash(requirementId, routeDecision.phase, routeDecision.outputs_pending),
    status: routeDecision.outputs_pending.length > 0 ? "in_progress" : "completed",
    outputs_completed: dedupeAndSort(routeDecision.outputs_completed),
    outputs_pending: dedupeAndSort(routeDecision.outputs_pending),
    last_gate_result: existingSession?.last_gate_result || null,
    last_error: existingSession?.status === "failed" ? existingSession.last_error : null,
    started_at: existingSession?.started_at || now,
    updated_at: now,
  };
  writeRequirementSessionState(sessionFile, updatedSession);

  agentkitInfo(`Session routed: ${relative(root, sessionFile)}`);
  agentkitInfo(
    `Route -> state=${routeDecision.state}, phase=${routeDecision.phase}, owner=${blueprint.owner_agent}, requirement=${reqRelDir}`,
  );
  if (updatedSession.outputs_pending.length > 0) {
    agentkitInfo(`Pending outputs: ${updatedSession.outputs_pending.join(", ")}`);
  } else {
    agentkitInfo("No pending outputs for current phase required outputs.");
  }
  const gateCommand = nextGateCommandForPhase(requirementId, routeDecision.phase);
  if (gateCommand) {
    agentkitInfo(`Next gate check: ${gateCommand}`);
  }
}

type BreakdownTask = {
  id: string;
  title: string;
};

type TaskAssignment = {
  task_id: string;
  repo: string;
  assignee: string;
  branch: string;
  context_query: string;
  input_docs: string[];
};

type RepoTaskCandidate = {
  requirement_id: string;
  requirement_title: string;
  requirement_state: RequirementState | "unknown";
  task_id: string;
  task_title: string;
  repo_key: string;
  repo_url: string;
  assignee: string;
  branch: string;
  context_query: string;
  input_docs: string[];
  task_input_file: string | null;
};

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseInlineYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter((item) => item.length > 0);
}

function parseBreakdownTasks(content: string): BreakdownTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: BreakdownTask[] = [];
  let current: BreakdownTask | null = null;

  const flush = (): void => {
    if (!current || !current.id) {
      current = null;
      return;
    }
    tasks.push({
      id: current.id,
      title: current.title || current.id,
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const idMatch = line.match(/^-\s*id:\s*(.+)$/);
    if (idMatch) {
      flush();
      current = {
        id: unquoteYamlValue(idMatch[1]),
        title: "",
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const titleMatch = line.match(/^title:\s*(.+)$/);
    if (titleMatch) {
      current.title = unquoteYamlValue(titleMatch[1]);
      continue;
    }
  }
  flush();
  return tasks;
}

function parseTaskAssignments(content: string): TaskAssignment[] {
  const lines = content.split(/\r?\n/);
  const assignments: TaskAssignment[] = [];
  let current: TaskAssignment | null = null;
  let captureInputDocs = false;

  const flush = (): void => {
    if (!current || !current.task_id || !current.repo) {
      current = null;
      captureInputDocs = false;
      return;
    }
    assignments.push({
      task_id: current.task_id,
      repo: current.repo,
      assignee: current.assignee || "unassigned",
      branch: current.branch || "",
      context_query: current.context_query || "",
      input_docs: dedupeAndSort(current.input_docs),
    });
    current = null;
    captureInputDocs = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const taskMatch = line.match(/^-\s*task_id:\s*(.+)$/);
    if (taskMatch) {
      flush();
      current = {
        task_id: unquoteYamlValue(taskMatch[1]),
        repo: "",
        assignee: "",
        branch: "",
        context_query: "",
        input_docs: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const repoMatch = line.match(/^repo:\s*(.+)$/);
    if (repoMatch) {
      current.repo = unquoteYamlValue(repoMatch[1]);
      captureInputDocs = false;
      continue;
    }
    const assigneeMatch = line.match(/^assignee:\s*(.+)$/);
    if (assigneeMatch) {
      current.assignee = unquoteYamlValue(assigneeMatch[1]);
      captureInputDocs = false;
      continue;
    }
    const branchMatch = line.match(/^branch:\s*(.+)$/);
    if (branchMatch) {
      current.branch = unquoteYamlValue(branchMatch[1]);
      captureInputDocs = false;
      continue;
    }
    const contextQueryMatch = line.match(/^context_query:\s*(.+)$/);
    if (contextQueryMatch) {
      current.context_query = unquoteYamlValue(contextQueryMatch[1]);
      captureInputDocs = false;
      continue;
    }
    const inputInlineMatch = line.match(/^input_docs:\s*(\[.*\])\s*$/);
    if (inputInlineMatch) {
      current.input_docs.push(...parseInlineYamlArray(inputInlineMatch[1]));
      captureInputDocs = false;
      continue;
    }
    const inputStartMatch = line.match(/^input_docs:\s*$/);
    if (inputStartMatch) {
      captureInputDocs = true;
      continue;
    }
    if (captureInputDocs) {
      const listMatch = line.match(/^-\s*(.+)$/);
      if (listMatch) {
        current.input_docs.push(unquoteYamlValue(listMatch[1]));
        continue;
      }
      captureInputDocs = false;
    }
  }
  flush();
  return assignments;
}

function resolveRuntimeRepoKey(repoRoot: string, contextRoot: string): string {
  const gitRepoKey = readGitLocalConfig(repoRoot, "agentkit.repoKey");
  if (gitRepoKey) {
    return gitRepoKey.trim();
  }
  const localBind = readLocalBindConfig(repoRoot);
  if (localBind.repo_key) {
    return localBind.repo_key.trim();
  }
  const projectRepoKey = readProjectRepoKey(repoRoot);
  if (projectRepoKey) {
    return projectRepoKey.trim();
  }
  return inferRepoKeyForWorkspace(repoRoot, contextRoot);
}

function updateWorkspaceOverrideForRuntimeRepo(repoRoot: string, contextRoot: string, repoKey: string): void {
  if (!repoKey.trim()) {
    return;
  }
  const result = upsertGlobalWorkspaceOverride(repoKey, repoRoot, contextRoot);
  if (!result.changed) {
    return;
  }
  agentkitInfo(`Updated global bind file: ${result.filePath}`);
  agentkitInfo(`Registered workspace override: ${repoKey} -> ${repoRoot}`);
}

type RequirementWorkspaceBinding = {
  repoKey: string;
  repoUrl: string;
  workspacePath: string | null;
  remoteMatched: boolean | null;
};

type MissingRequirementWorkspace = {
  repoKey: string;
  repoUrl: string;
};

function upsertGlobalWorkspaceOverride(
  repoKey: string,
  workspacePath: string,
  contextRoot: string,
): { changed: boolean; filePath: string } {
  const globalBind = readGlobalBindConfig();
  const currentPath = globalBind.workspace_overrides?.[repoKey] || "";
  const nextGlobalBind: GlobalBindConfig = {
    ...globalBind,
    context_root: globalBind.context_root || contextRoot,
    workspace_overrides: {
      ...(globalBind.workspace_overrides || {}),
      [repoKey]: workspacePath,
    },
  };
  const currentContextRoot = globalBind.context_root || "";
  const nextContextRoot = nextGlobalBind.context_root || "";
  if (currentPath === workspacePath && currentContextRoot === nextContextRoot) {
    return {
      changed: false,
      filePath: bindGlobalConfigPath(),
    };
  }
  return {
    changed: true,
    filePath: writeGlobalBindConfig(nextGlobalBind),
  };
}

function workspacePathMatchesRepoLink(contextRoot: string, repoUrl: string, workspacePath: string): boolean | null {
  if (!repoUrl.trim()) {
    return null;
  }
  if (!existsSync(workspacePath)) {
    return null;
  }
  if (!looksLikeRemoteRepo(repoUrl)) {
    const resolvedRepoPath = resolveOptionalLocalPath(contextRoot, repoUrl);
    if (!resolvedRepoPath) {
      return null;
    }
    return resolvedRepoPath === workspacePath;
  }
  const remotes = listGitRemoteUrls(workspacePath);
  if (remotes.length === 0) {
    return null;
  }
  const expectedSlug = slugFromRepoValue(repoUrl);
  return remotes.some((remoteUrl) => {
    if (remoteUrl.trim() === repoUrl.trim()) {
      return true;
    }
    return slugFromRepoValue(remoteUrl) === expectedSlug;
  });
}

function inferRepoKeyForLocalWorkspace(contextRoot: string, workspacePath: string, serviceName: string): string {
  const inferred = inferRepoKeyForWorkspace(workspacePath, contextRoot);
  if (inferred) {
    return inferred;
  }
  const repoLinks = readRepoLinks(join(contextRoot, "requirements", "repo-links.yml"));
  if (repoLinks[serviceName]) {
    return serviceName;
  }
  const serviceSlug = agentkitSlugify(serviceName);
  for (const [repoKey, repoUrl] of Object.entries(repoLinks)) {
    if (agentkitSlugify(repoKey) === serviceSlug || slugFromRepoValue(repoUrl) === serviceSlug) {
      return repoKey;
    }
  }
  return "";
}

function collectRequirementWorkspaceBindings(root: string, requirementDir: string): RequirementWorkspaceBinding[] {
  const assignmentPath = join(requirementDir, "06-task-assignment.yaml");
  if (!existsSync(assignmentPath)) {
    return [];
  }
  const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
  const assignments = parseTaskAssignments(readFileSync(assignmentPath, "utf8"));
  const seen = new Set<string>();
  const bindings: RequirementWorkspaceBinding[] = [];

  for (const assignment of assignments) {
    const repoKey = resolveRepoKeyForUrl(repoLinks, assignment.repo);
    if (seen.has(repoKey)) {
      continue;
    }
    const workspacePath = resolveLocalWorkspacePath(root, repoKey, assignment.repo);
    bindings.push({
      repoKey,
      repoUrl: assignment.repo,
      workspacePath,
      remoteMatched: workspacePath ? workspacePathMatchesRepoLink(root, assignment.repo, workspacePath) : null,
    });
    seen.add(repoKey);
  }

  return bindings.sort((a, b) => a.repoKey.localeCompare(b.repoKey));
}

function collectMissingRequirementWorkspaces(root: string, requirementDir: string): MissingRequirementWorkspace[] {
  return collectRequirementWorkspaceBindings(root, requirementDir)
    .filter((binding) => !binding.workspacePath)
    .map((binding) => ({
      repoKey: binding.repoKey,
      repoUrl: binding.repoUrl,
    }));
}

function warnOnRequirementWorkspaceBindings(root: string, requirementDir: string): void {
  for (const binding of collectRequirementWorkspaceBindings(root, requirementDir)) {
    if (binding.workspacePath && binding.remoteMatched === false) {
      agentkitWarn(
        `Workspace override for '${binding.repoKey}' points to ${binding.workspacePath}, but git remote does not match ${binding.repoUrl}. Verify ~/.agentkit/config.json.`,
      );
    }
  }
}

function logMissingRequirementWorkspaces(missing: MissingRequirementWorkspace[]): void {
  for (const item of missing) {
    const repoSource = item.repoUrl ? ` (repo=${item.repoUrl})` : "";
    agentkitWarn(`Missing local workspace for '${item.repoKey}'${repoSource}.`);
    agentkitWarn(
      `Collect it with a local-path load-service run, for example: agentkit load-service <absolute-repo-path> --name ${item.repoKey}`,
    );
  }
}

function missingRequirementWorkspaceMessage(missing: MissingRequirementWorkspace[]): string {
  return `Missing local workspaces: ${missing.map((item) => item.repoKey).join(", ")}`;
}

function taskInputFileForRepo(requirementDir: string, repoLinks: RepoLinks, repoKey: string): string | null {
  const taskInputs = listTaskInputFiles(requirementDir);
  for (const fileName of taskInputs) {
    const resolved = resolveRepoKeyByTaskInput(repoLinks, fileName);
    if (resolved.repoKey === repoKey) {
      return fileName;
    }
  }
  return null;
}

function listRequirementRepoTaskCandidates(root: string, requirementId: string, repoKeyFilter: string = ""): RepoTaskCandidate[] {
  const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
  const indexFile = join(root, "requirements", "INDEX.md");
  const { dir: requirementDir } = findRequirementDir(root, requirementId);
  const assignmentPath = join(requirementDir, "06-task-assignment.yaml");
  if (!existsSync(assignmentPath)) {
    return [];
  }
  const assignments = parseTaskAssignments(readFileSync(assignmentPath, "utf8"));
  if (assignments.length === 0) {
    return [];
  }
  const taskTitles = existsSync(join(requirementDir, "05-task-breakdown.yaml"))
    ? parseBreakdownTasks(readFileSync(join(requirementDir, "05-task-breakdown.yaml"), "utf8"))
    : [];
  const taskTitleMap = new Map(taskTitles.map((item) => [item.id, item.title]));
  const requirementTitle = inferRequirementTitleFromIntake(requirementDir, requirementId);
  const requirementState = readRequirementStateFromIndex(indexFile, requirementId) || "unknown";
  const candidates: RepoTaskCandidate[] = [];
  for (const assignment of assignments) {
    const repoKey = resolveRepoKeyForUrl(repoLinks, assignment.repo);
    if (repoKeyFilter && repoKey !== repoKeyFilter) {
      continue;
    }
    candidates.push({
      requirement_id: requirementId,
      requirement_title: requirementTitle,
      requirement_state: requirementState,
      task_id: assignment.task_id,
      task_title: taskTitleMap.get(assignment.task_id) || assignment.task_id,
      repo_key: repoKey,
      repo_url: assignment.repo,
      assignee: assignment.assignee,
      branch: assignment.branch,
      context_query: assignment.context_query,
      input_docs: assignment.input_docs,
      task_input_file: taskInputFileForRepo(requirementDir, repoLinks, repoKey),
    });
  }
  return candidates.sort((a, b) => a.task_id.localeCompare(b.task_id));
}

function listInProgressRepoTaskCandidates(root: string, repoKey: string): RepoTaskCandidate[] {
  return listInProgressRequirementChoices(root)
    .flatMap((choice) => listRequirementRepoTaskCandidates(root, choice.requirementId, repoKey))
    .sort((a, b) => {
      const byReq = b.requirement_id.localeCompare(a.requirement_id);
      if (byReq !== 0) {
        return byReq;
      }
      return a.task_id.localeCompare(b.task_id);
    });
}

function findTaskCandidatesByTaskId(root: string, taskId: string, repoKeyFilter: string = ""): RepoTaskCandidate[] {
  const normalized = taskId.trim();
  if (!normalized) {
    return [];
  }
  return listInProgressRequirementChoices(root)
    .flatMap((choice) => listRequirementRepoTaskCandidates(root, choice.requirementId, repoKeyFilter))
    .filter((candidate) => candidate.task_id === normalized)
    .sort((a, b) => b.requirement_id.localeCompare(a.requirement_id));
}

function renderRepoTaskCandidate(candidate: RepoTaskCandidate, root: string): string[] {
  const requirementDir = findRequirementDir(root, candidate.requirement_id).dir;
  const lines = [
    `- Requirement: ${candidate.requirement_id} [state=${candidate.requirement_state}] ${candidate.requirement_title}`,
    `- Task: ${candidate.task_id} ${candidate.task_title}`,
    `- Repo: ${candidate.repo_key} (${candidate.repo_url})`,
    `- Assignee: ${candidate.assignee}`,
  ];
  if (candidate.branch) {
    lines.push(`- Branch: ${candidate.branch}`);
  }
  if (candidate.context_query) {
    lines.push(`- Context Query: ${candidate.context_query}`);
  }
  if (candidate.input_docs.length > 0) {
    lines.push(`- Input Docs: ${candidate.input_docs.join(", ")}`);
  }
  if (candidate.task_input_file) {
    lines.push(`- Task Input: ${relative(root, join(requirementDir, candidate.task_input_file))}`);
  }
  return lines;
}

function printRepoTaskCandidates(title: string, candidates: RepoTaskCandidate[], root: string): void {
  agentkitInfo(title);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    agentkitInfo(`Option ${index + 1}:`);
    for (const line of renderRepoTaskCandidate(candidate, root)) {
      agentkitInfo(`  ${line}`);
    }
  }
}

function slugFromRepoValue(repoValue: string): string {
  const cleaned = repoValue
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const base = cleaned.split("/").pop() || cleaned;
  return agentkitSlugify(base || "repo");
}

function resolveRepoKeyForUrl(repoLinks: RepoLinks, repoUrl: string): string {
  const matched = findRepoKeyByUrl(repoLinks, repoUrl);
  if (matched) {
    return matched;
  }
  return slugFromRepoValue(repoUrl.trim());
}

function findServiceContextFile(root: string, repoKey: string, repoUrl: string): string | null {
  const candidates = [repoKey, slugFromRepoValue(repoUrl)];
  for (const candidate of candidates) {
    const filePath = join(root, "context", "tech", "services", `${candidate}.md`);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

type MissingServiceContext = {
  repoKey: string;
  repoUrl: string;
  suggestedServiceName: string;
};

function collectMissingServiceContexts(root: string, repoLinks: RepoLinks): MissingServiceContext[] {
  const missing: MissingServiceContext[] = [];
  for (const [repoKey, repoUrl] of Object.entries(repoLinks)) {
    if (!findServiceContextFile(root, repoKey, repoUrl)) {
      missing.push({
        repoKey,
        repoUrl,
        suggestedServiceName: agentkitSlugify(repoKey),
      });
    }
  }
  return missing.sort((a, b) => a.repoKey.localeCompare(b.repoKey));
}

type SubAgentDispatchEntry = {
  repoKey: string;
  repoUrl: string;
  taskInputFile: string;
  taskInputPath: string;
  workspacePath: string | null;
};

type SubAgentDispatchResult = {
  markdown_path: string;
  script_path: string;
  warnings: string[];
};

function taskInputSlug(fileName: string): string {
  return fileName.replace(/^task-input-/i, "").replace(/\.md$/i, "");
}

function resolveRepoKeyByTaskInput(repoLinks: RepoLinks, fileName: string): { repoKey: string; repoUrl: string } {
  const slug = taskInputSlug(fileName);
  const byKey = Object.keys(repoLinks).find((key) => agentkitSlugify(key) === slug);
  if (byKey) {
    return { repoKey: byKey, repoUrl: repoLinks[byKey] };
  }
  for (const [key, value] of Object.entries(repoLinks)) {
    if (slugFromRepoValue(value) === slug) {
      return { repoKey: key, repoUrl: value };
    }
  }
  return { repoKey: slug, repoUrl: "" };
}

function resolveLocalWorkspacePath(root: string, repoKey: string, repoValue: string): string | null {
  if (!repoKey.trim() && !repoValue.trim()) {
    return null;
  }
  const globalBind = readGlobalBindConfig();
  const overridePath = globalBind.workspace_overrides?.[repoKey];
  const resolvedOverride = overridePath ? resolveOptionalLocalPath(root, overridePath) : null;
  if (resolvedOverride) {
    return resolvedOverride;
  }
  if (!repoValue.trim()) {
    return null;
  }
  if (looksLikeRemoteRepo(repoValue) && !looksLikeLocalSource(repoValue)) {
    return null;
  }
  return resolveOptionalLocalPath(root, repoValue);
}

function renderSubAgentDispatchMarkdown(
  requirementId: string,
  requirementDir: string,
  entries: SubAgentDispatchEntry[],
  warnings: string[],
): string {
  const lines: string[] = [];
  lines.push(`# Sub-Agent Dispatch: ${requirementId}`);
  lines.push("");
  lines.push("## Parallel Units");
  lines.push("");
  lines.push("| Repo | Task Input | Workspace | Runnable |");
  lines.push("|---|---|---|---|");
  for (const entry of entries) {
    const workspaceCell = entry.workspacePath || entry.repoUrl || "N/A";
    const runnable = entry.workspacePath ? "yes" : "no";
    lines.push(
      `| ${entry.repoKey} | ${entry.taskInputFile} | ${compactContextCell(workspaceCell, 64)} | ${runnable} |`,
    );
  }
  lines.push("");
  lines.push("## Run");
  lines.push("");
  lines.push("1. Set command template with placeholders: `{repo_path}` `{task_input}` `{repo_key}`.");
  lines.push("2. Execute the generated shell script.");
  lines.push("");
  lines.push("```bash");
  lines.push("export AGENTKIT_SUBAGENT_CMD='codex -C {repo_path} \"按 {task_input} 实现并提交 PR\"'");
  lines.push(`bash ${join(requirementDir, "sub-agent-dispatch.sh")}`);
  lines.push("```");
  if (warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderSubAgentDispatchScript(requirementId: string, entries: SubAgentDispatchEntry[]): string {
  const runnable = entries.filter((entry) => Boolean(entry.workspacePath));
  const lines: string[] = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `echo "[agentkit] sub-agent dispatch for ${requirementId}"`,
    "",
    "run_subagent() {",
    "  local repo_key=\"$1\"",
    "  local repo_path=\"$2\"",
    "  local task_input=\"$3\"",
    "  if [[ -z \"${AGENTKIT_SUBAGENT_CMD:-}\" ]]; then",
    "    echo \"[todo][$repo_key] set AGENTKIT_SUBAGENT_CMD with placeholders: {repo_path} {task_input} {repo_key}\"",
    "    echo \"[todo][$repo_key] repo_path=$repo_path task_input=$task_input\"",
    "    return 0",
    "  fi",
    "  local cmd=\"$AGENTKIT_SUBAGENT_CMD\"",
    "  cmd=\"${cmd//\\{repo_path\\}/$repo_path}\"",
    "  cmd=\"${cmd//\\{task_input\\}/$task_input}\"",
    "  cmd=\"${cmd//\\{repo_key\\}/$repo_key}\"",
    "  echo \"[run][$repo_key] $cmd\"",
    "  bash -lc \"$cmd\"",
    "}",
    "",
  ];
  if (runnable.length === 0) {
    lines.push("echo \"[agentkit] no runnable local workspaces found in repo-links.yml\"");
    lines.push("exit 0");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of runnable) {
    lines.push(
      `run_subagent ${shellEscape(entry.repoKey)} ${shellEscape(entry.workspacePath || "")} ${shellEscape(entry.taskInputPath)} &`,
    );
  }
  lines.push("");
  lines.push("wait");
  lines.push("echo \"[agentkit] sub-agent dispatch finished.\"");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeSubAgentDispatchArtifacts(root: string, requirementId: string, requirementDir: string): SubAgentDispatchResult {
  const taskInputs = listTaskInputFiles(requirementDir);
  if (taskInputs.length === 0) {
    throw new AgentKitCliError("No task-input-*.md found. Run routing/task-input generation first.");
  }
  const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
  const warnings: string[] = [];
  const entries: SubAgentDispatchEntry[] = taskInputs.map((fileName) => {
    const resolved = resolveRepoKeyByTaskInput(repoLinks, fileName);
    const workspacePath = resolveLocalWorkspacePath(root, resolved.repoKey, resolved.repoUrl);
    if (!resolved.repoUrl) {
      warnings.push(`No repo link mapped for ${fileName}; update requirements/repo-links.yml.`);
    } else if (!workspacePath) {
      warnings.push(
        `Repo '${resolved.repoKey}' has no local workspace. Register it via 'agentkit load-service <absolute-repo-path> --name ${resolved.repoKey}' in agent-project-kit, or open that repo and run req-dev once.`,
      );
    }
    return {
      repoKey: resolved.repoKey,
      repoUrl: resolved.repoUrl,
      taskInputFile: fileName,
      taskInputPath: join(requirementDir, fileName),
      workspacePath,
    };
  });

  const markdownPath = join(requirementDir, "sub-agent-dispatch.md");
  const scriptPath = join(requirementDir, "sub-agent-dispatch.sh");
  writeFileSync(markdownPath, renderSubAgentDispatchMarkdown(requirementId, requirementDir, entries, warnings), "utf8");
  writeFileSync(scriptPath, renderSubAgentDispatchScript(requirementId, entries), "utf8");
  chmodSync(scriptPath, 0o755);
  return {
    markdown_path: markdownPath,
    script_path: scriptPath,
    warnings,
  };
}

function firstHeadingOrFallback(filePath: string): string {
  if (!existsSync(filePath)) {
    return "missing";
  }
  const content = readFileSync(filePath, "utf8");
  const line = content.split(/\r?\n/).find((entry) => entry.trim().startsWith("# "));
  if (!line) {
    return "available";
  }
  return line.trim().replace(/^#\s+/, "");
}

function renderTaskInputMarkdown(params: {
  repoKey: string;
  repoUrl: string;
  tasks: Array<{ id: string; title: string; assignee: string }>;
  inputDocs: string[];
  serviceContextRel: string | null;
  requirementDir: string;
}): string {
  const objectiveLines = params.tasks.map(
    (task) => `- ${task.id}: ${task.title}（assignee: ${task.assignee || "unassigned"}）`,
  );
  const inputLines = params.inputDocs.map((doc) => {
    const docPath = join(params.requirementDir, doc);
    const summary = firstHeadingOrFallback(docPath);
    return `- ${doc} (${summary})`;
  });
  const constraintsLines: string[] = [
    "- Follow `02-technical-solution.md` and keep architecture compatibility.",
    "- Follow `03-api-design.yaml` / `03-api-design.md` as contract source.",
    "- Keep changes reviewable, with rollback and test evidence.",
  ];
  if (params.serviceContextRel) {
    constraintsLines.push(`- Service context required: ${params.serviceContextRel}`);
  } else {
    constraintsLines.push("- Service context missing: create via `agentkit load-service` before coding.");
  }

  return `# Task Input: ${params.repoKey}

## Objective

${objectiveLines.length > 0 ? objectiveLines.join("\n") : "- No task mapping found."}

## Constraints

${constraintsLines.join("\n")}

## Inputs

${inputLines.length > 0 ? inputLines.join("\n") : "- No input docs declared in assignment."}

## Deliverables

- Code changes and tests in target repository: ${params.repoUrl}
- PR link with verification summary
- Update requirement delivery tracking in \`07-delivery.md\`
`;
}

function ensureDeliveryTrackingByRepo(requirementDir: string, repoEntries: Array<[string, string]>): boolean {
  const deliveryPath = join(requirementDir, "07-delivery.md");
  let content = existsSync(deliveryPath)
    ? readFileSync(deliveryPath, "utf8")
    : "# Delivery\n\n## PR Links\n\n## Validation\n\n## Repo Tracking\n";
  if (!/^##\s+Repo Tracking/m.test(content)) {
    content = `${content.trimEnd()}\n\n## Repo Tracking\n`;
  }
  let changed = false;
  for (const [repoKey, repoUrl] of repoEntries) {
    const marker = new RegExp(`^###\\s+${escapeRegExp(repoKey)}\\s*$`, "m");
    if (marker.test(content)) {
      continue;
    }
    content = `${content.trimEnd()}\n\n### ${repoKey}\n- Repo: ${repoUrl}\n- PR: TODO\n- Status: TODO\n- Validation: TODO\n`;
    changed = true;
  }
  if (!existsSync(deliveryPath) || changed) {
    writeFileSync(deliveryPath, `${content.trimEnd()}\n`, "utf8");
    return true;
  }
  return false;
}

function generateTaskInputArtifacts(root: string, requirementId: string, requirementDir: string): {
  generated_files: string[];
  delivery_updated: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
  const breakdownPath = join(requirementDir, "05-task-breakdown.yaml");
  const assignmentPath = join(requirementDir, "06-task-assignment.yaml");
  if (!existsSync(assignmentPath)) {
    throw new AgentKitCliError(`Missing task assignment file: ${relative(root, assignmentPath)}`);
  }
  const assignments = parseTaskAssignments(readFileSync(assignmentPath, "utf8"));
  if (assignments.length === 0) {
    throw new AgentKitCliError("No assignments parsed from 06-task-assignment.yaml.");
  }
  const taskTitles = existsSync(breakdownPath)
    ? parseBreakdownTasks(readFileSync(breakdownPath, "utf8"))
    : [];
  const taskTitleMap = new Map(taskTitles.map((item) => [item.id, item.title]));

  const grouped = new Map<string, TaskAssignment[]>();
  for (const assignment of assignments) {
    const key = assignment.repo.trim();
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(assignment);
  }

  const generatedFiles: string[] = [];
  const repoEntriesForDelivery: Array<[string, string]> = [];
  for (const [repoUrl, repoAssignments] of grouped.entries()) {
    const repoKey = resolveRepoKeyForUrl(repoLinks, repoUrl);
    const serviceContextPath = findServiceContextFile(root, repoKey, repoUrl);
    if (!serviceContextPath) {
      warnings.push(`Missing service context for repo '${repoKey}' (${repoUrl}).`);
    }
    const taskRows = repoAssignments.map((assignment) => ({
      id: assignment.task_id,
      title: taskTitleMap.get(assignment.task_id) || assignment.task_id,
      assignee: assignment.assignee,
    }));
    const inputDocs = dedupeAndSort(repoAssignments.flatMap((assignment) => assignment.input_docs));
    const taskInputContent = renderTaskInputMarkdown({
      repoKey,
      repoUrl,
      tasks: taskRows,
      inputDocs,
      serviceContextRel: serviceContextPath ? relative(root, serviceContextPath) : null,
      requirementDir,
    });
    const fileName = `task-input-${agentkitSlugify(repoKey)}.md`;
    const filePath = join(requirementDir, fileName);
    writeFileSync(filePath, taskInputContent, "utf8");
    generatedFiles.push(fileName);
    repoEntriesForDelivery.push([repoKey, repoUrl]);
  }

  const deliveryUpdated = ensureDeliveryTrackingByRepo(requirementDir, repoEntriesForDelivery);
  return {
    generated_files: generatedFiles.sort((a, b) => a.localeCompare(b)),
    delivery_updated: deliveryUpdated,
    warnings,
  };
}

function updateRequirementsIndex(
  indexFile: string,
  requirementId: string,
  title: string,
  owner: string,
  domain: string,
  status: "in-progress" | "completed",
  metadata?: { state?: RequirementState; lastGateCheck?: string; lastGateResult?: string },
): void {
  const parts = [`- ${requirementId}`, title, `owner=${owner}`, `domain=${domain}`, `status=${status}`];
  if (metadata?.state) {
    parts.push(`state=${metadata.state}`);
  }
  if (metadata?.lastGateCheck) {
    parts.push(`last_gate_check=${metadata.lastGateCheck}`);
  }
  if (metadata?.lastGateResult) {
    parts.push(`last_gate_result=${metadata.lastGateResult}`);
  }
  const entry = parts.join(" | ");
  let content = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "# Requirements Index\n\n## In Progress\n\n## Completed\n";
  if (content.includes(`- ${requirementId} |`)) {
    const pattern = new RegExp(`^- ${requirementId} \\|.*$`, "m");
    content = content.replace(pattern, entry);
    writeFileSync(indexFile, content, "utf8");
    return;
  }

  const section = status === "completed" ? "## Completed" : "## In Progress";
  const marker = `${section}\n`;
  if (content.includes(marker)) {
    content = content.replace(marker, `${marker}${entry}\n`);
  } else {
    content = `${content}\n${section}\n${entry}\n`;
  }
  writeFileSync(indexFile, content, "utf8");
}

function updateRequirementGateMetadata(
  indexFile: string,
  requirementId: string,
  metadata: { state?: RequirementState; lastGateCheck: string; lastGateResult: "PASS" | "FAIL" },
): void {
  const derivedStatus =
    metadata.state === "completed" || metadata.state === "archived" ? "completed" : "in-progress";
  let content = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "# Requirements Index\n\n## In Progress\n\n## Completed\n";
  const pattern = new RegExp(`^- ${requirementId} \\|.*$`, "m");
  const match = content.match(pattern);
  if (!match) {
    const entry = `- ${requirementId} | ${requirementId} | owner=unknown | domain=general | status=${derivedStatus} | state=${metadata.state || "draft"} | last_gate_check=${metadata.lastGateCheck} | last_gate_result=${metadata.lastGateResult}`;
    const marker = derivedStatus === "completed" ? "## Completed\n" : "## In Progress\n";
    if (content.includes(marker)) {
      content = content.replace(marker, `${marker}${entry}\n`);
    } else {
      content = `${content}\n${marker}${entry}\n`;
    }
    writeFileSync(indexFile, content, "utf8");
    return;
  }

  const currentLine = match[0];
  const lineParts = currentLine.split("|").map((item) => item.trim());
  const filtered = lineParts.filter(
    (item) =>
      !item.startsWith("state=") &&
      !item.startsWith("last_gate_check=") &&
      !item.startsWith("last_gate_result=") &&
      !item.startsWith("status="),
  );
  filtered.push(`status=${derivedStatus}`);
  filtered.push(`state=${metadata.state || "draft"}`);
  filtered.push(`last_gate_check=${metadata.lastGateCheck}`);
  filtered.push(`last_gate_result=${metadata.lastGateResult}`);
  const updatedLine = filtered.join(" | ");
  content = content.replace(pattern, "");
  const targetMarker = derivedStatus === "completed" ? "## Completed\n" : "## In Progress\n";
  if (content.includes(targetMarker)) {
    content = content.replace(targetMarker, `${targetMarker}${updatedLine}\n`);
  } else {
    content = `${content}\n${targetMarker}${updatedLine}\n`;
  }
  writeFileSync(indexFile, content, "utf8");
}

function requirementIdFromTask(task: string): string {
  const date = new Date();
  const datePart = `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
  const taskSlug = smartSlug(task, "task");
  const semanticTask = stripDuplicateDatePrefixFromTaskSlug(taskSlug, datePart).slice(0, 48).replace(/-+$/g, "");
  if (!semanticTask) {
    throw new AgentKitCliError(
      "task must include semantic text beyond date prefix to generate requirement id.",
    );
  }
  return `req-${datePart}-${semanticTask}`;
}

function isRequirementState(value: string): value is RequirementState {
  return (
    value === "draft" ||
    value === "intake-reviewed" ||
    value === "design" ||
    value === "design-reviewed" ||
    value === "implementing" ||
    value === "validating" ||
    value === "completed" ||
    value === "archived"
  );
}

function parseTransitionSpec(spec: string): { from: RequirementState; to: RequirementState } {
  const parts = spec.split(":").map((item) => item.trim());
  if (parts.length !== 2) {
    throw new AgentKitCliError("Invalid --transition format. Use '<from>:<to>' (for example design:implementing).");
  }
  if (!isRequirementState(parts[0]) || !isRequirementState(parts[1])) {
    throw new AgentKitCliError(
      "Invalid state in --transition. Allowed: draft, intake-reviewed, design, design-reviewed, implementing, validating, completed, archived.",
    );
  }
  return { from: parts[0], to: parts[1] };
}

function findRequirementDir(root: string, requirementId: string): { dir: string; relDir: string } {
  const candidates = [
    join(root, "requirements", "in-progress", requirementId),
    join(root, "requirements", "completed", requirementId),
    join(root, "requirements", "archive", requirementId),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { dir: candidate, relDir: relative(root, candidate) };
    }
  }
  throw new AgentKitCliError(`Requirement not found: ${requirementId}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkdownSection(content: string, heading: string): string {
  const pattern = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`,
    "im",
  );
  const match = content.match(pattern);
  return match?.[1]?.trim() || "";
}

function hasOptimizedExperience(root: string, requirementId: string): boolean {
  const experienceDir = join(root, "context", "records", "experience");
  if (!existsSync(experienceDir)) {
    return false;
  }
  if (commandExists("rg")) {
    const probe = runCommand(
      "rg",
      ["-l", `^flow_id:\\s*${escapeRegExp(requirementId)}\\s*$`, experienceDir],
      { allowFailure: true },
    );
    return probe.status === 0 && probe.stdout.trim().length > 0;
  }
  return false;
}

function evaluateRequirementGate(
  root: string,
  requirementId: string,
  fromState: RequirementState,
  toState: RequirementState,
): GateEvaluation {
  const { dir, relDir } = findRequirementDir(root, requirementId);
  const checks: GateCheckItem[] = [];
  const fileText = (name: string): string => {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) {
      return "";
    }
    return readFileSync(filePath, "utf8");
  };
  const exists = (name: string): boolean => existsSync(join(dir, name));
  const add = (id: string, passed: boolean, message: string): void => {
    checks.push({ id, passed, message });
  };

  if (
    (fromState === "draft" && toState === "intake-reviewed") ||
    (fromState === "draft" && toState === "design")
  ) {
    const intake = fileText("00-intake.md");
    add("intake-exists", intake.length > 0, "00-intake.md must exist.");
    const hasSource =
      /PRD Link \(Feishu\):\s*(?!TODO\b).+/i.test(intake) || /Ticket Link:\s*(?!TODO\b).+/i.test(intake);
    add("source-filled", hasSource, "00-intake.md must include PRD or Ticket source.");
    add("test-mindmap-exists", exists("01-test-cases.mmd"), "01-test-cases.mmd must exist.");
    add(
      "test-mindmap-meaningful",
      isMeaningfulRequirementOutput(dir, "01-test-cases.mmd"),
      "01-test-cases.mmd must contain concrete test paths (no TODO placeholder).",
    );
    if (toState === "intake-reviewed") {
      add(
        "review-intake-approved",
        readApprovedReviewFile(dir, ".review-intake.json"),
        ".review-intake.json must exist and be approved=true.",
      );
    }
  }

  if (fromState === "intake-reviewed" && toState === "design") {
    add("solution-exists", exists("02-technical-solution.md"), "02-technical-solution.md must exist.");
    add("solution-meaningful", isMeaningfulRequirementOutput(dir, "02-technical-solution.md"), "02-technical-solution.md must be filled (not TODO).");
    add("api-yaml-exists", exists("03-api-design.yaml"), "03-api-design.yaml must exist.");
    add("api-yaml-meaningful", isMeaningfulRequirementOutput(dir, "03-api-design.yaml"), "03-api-design.yaml must define at least one API path.");
    add("api-md-exists", exists("03-api-design.md"), "03-api-design.md must exist.");
    add("api-md-meaningful", isMeaningfulRequirementOutput(dir, "03-api-design.md"), "03-api-design.md must define concrete API contract details.");
    add("ui-exists", exists("04-ui-handoff.md"), "04-ui-handoff.md must exist.");
    add("ui-meaningful", isMeaningfulRequirementOutput(dir, "04-ui-handoff.md"), "04-ui-handoff.md must be filled (not TODO).");
  }

  if (fromState === "design" && toState === "design-reviewed") {
    add(
      "review-design-approved",
      readApprovedReviewFile(dir, ".review-design.json"),
      ".review-design.json must exist and be approved=true.",
    );
  }

  if (
    (fromState === "design-reviewed" && toState === "implementing") ||
    (fromState === "design" && toState === "implementing")
  ) {
    add("solution-exists", exists("02-technical-solution.md"), "02-technical-solution.md must exist.");
    add("solution-meaningful", isMeaningfulRequirementOutput(dir, "02-technical-solution.md"), "02-technical-solution.md must be filled (not TODO).");
    add("api-yaml-exists", exists("03-api-design.yaml"), "03-api-design.yaml must exist.");
    add("api-yaml-meaningful", isMeaningfulRequirementOutput(dir, "03-api-design.yaml"), "03-api-design.yaml must define at least one API path.");
    add("api-md-exists", exists("03-api-design.md"), "03-api-design.md must exist.");
    add("api-md-meaningful", isMeaningfulRequirementOutput(dir, "03-api-design.md"), "03-api-design.md must define concrete API contract details.");
    add("ui-exists", exists("04-ui-handoff.md"), "04-ui-handoff.md must exist.");
    add("ui-meaningful", isMeaningfulRequirementOutput(dir, "04-ui-handoff.md"), "04-ui-handoff.md must be filled (not TODO).");

    const breakdown = fileText("05-task-breakdown.yaml");
    add(
      "task-breakdown-items",
      /-\s*id:\s*\S+/i.test(breakdown),
      "05-task-breakdown.yaml must include at least one task item.",
    );

    const assignment = fileText("06-task-assignment.yaml");
    const hasAssignmentFields =
      /\brepo:\s*.+/i.test(assignment) &&
      /\bassignee:\s*.+/i.test(assignment) &&
      /\binput_docs:\s*\[.*\]/i.test(assignment);
    add(
      "task-assignment-fields",
      hasAssignmentFields,
      "06-task-assignment.yaml must include repo, assignee, and input_docs.",
    );
    add(
      "task-input-exists",
      listTaskInputFiles(dir).length > 0,
      "At least one task-input-*.md must exist before entering implementing.",
    );
    add("delivery-exists", exists("07-delivery.md"), "07-delivery.md must exist.");
    add(
      "sub-agent-dispatch-exists",
      exists("sub-agent-dispatch.md") && exists("sub-agent-dispatch.sh"),
      "sub-agent-dispatch.md and sub-agent-dispatch.sh must exist before entering implementing.",
    );
    const missingWorkspaces = collectMissingRequirementWorkspaces(root, dir);
    add(
      "workspace-overrides-registered",
      missingWorkspaces.length === 0,
      missingWorkspaces.length === 0
        ? "Local workspace paths are registered for all implementation repos."
        : `~/.agentkit/config.json is missing local workspace paths for: ${missingWorkspaces.map((item) => item.repoKey).join(", ")}.`,
    );
  }

  if (fromState === "implementing" && toState === "validating") {
    const delivery = fileText("07-delivery.md");
    add("delivery-exists", delivery.length > 0, "07-delivery.md must exist.");
    const hasPrLink = /Backend PR:\s*https?:\/\/\S+/i.test(delivery) || /Frontend PR:\s*https?:\/\/\S+/i.test(delivery);
    add("delivery-pr-links", hasPrLink, "07-delivery.md must include at least one PR link.");

    const validation = extractMarkdownSection(delivery, "Validation");
    const hasValidationFields =
      /Unit tests:/i.test(validation) && /Integration tests:/i.test(validation) && /Regression tests:/i.test(validation);
    add(
      "validation-fields",
      hasValidationFields,
      "Validation section must include Unit/Integration/Regression test fields.",
    );
  }

  if (fromState === "validating" && toState === "completed") {
    const delivery = fileText("07-delivery.md");
    const validation = extractMarkdownSection(delivery, "Validation");
    const unitDone = /Unit tests:\s*(?!TODO\b).+/i.test(validation);
    const integrationDone = /Integration tests:\s*(?!TODO\b).+/i.test(validation);
    const regressionDone = /Regression tests:\s*(?!TODO\b).+/i.test(validation);
    add("validation-results", unitDone && integrationDone && regressionDone, "Validation results must be filled (not TODO).");

    const rollback = extractMarkdownSection(delivery, "Release and Rollback");
    add(
      "rollback-filled",
      rollback.length > 0 && !/\bTODO\b/i.test(rollback),
      "Release and Rollback section must be filled (not TODO).",
    );

    add(
      "experience-written",
      hasOptimizedExperience(root, requirementId),
      "At least one experience record with flow_id=<requirement-id> is required.",
    );
  }

  if (fromState === "completed" && toState === "archived") {
    const requiredFiles = [
      "00-intake.md",
      "01-test-cases.mmd",
      "02-technical-solution.md",
      "03-api-design.yaml",
      "03-api-design.md",
      "04-ui-handoff.md",
      "05-task-breakdown.yaml",
      "06-task-assignment.yaml",
      "sub-agent-dispatch.md",
      "sub-agent-dispatch.sh",
      "07-delivery.md",
      "08-retro.md",
    ];
    const allPresent = requiredFiles.every((name) => exists(name));
    add("archive-files-complete", allPresent, "All requirement artifacts must exist before archiving.");
  }

  if (checks.length === 0) {
    add("transition-supported", false, `Gate checks for transition '${fromState}:${toState}' are not defined yet.`);
  }

  const passed = checks.every((item) => item.passed);
  return {
    passed,
    checks,
    requirementDir: dir,
    requirementRelDir: relDir,
    fromState,
    toState,
  };
}

function writeGateReport(root: string, requirementDir: string, result: GateEvaluation): string {
  const reportPath = join(requirementDir, ".gate-report.json");
  const payload = {
    requirement_id: basename(requirementDir),
    from_state: result.fromState,
    to_state: result.toState,
    passed: result.passed,
    failed_checks: result.checks.filter((item) => !item.passed),
    all_checks: result.checks,
    generated_at: agentkitTimestampUtc(),
  };
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relative(root, reportPath);
}

function normalizeRuleValue(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildRuleDedupKey(type: string, domain: string, trigger: string, action: string, insight: string): string {
  return [
    normalizeRuleValue(type),
    normalizeRuleValue(domain),
    normalizeRuleValue(trigger),
    normalizeRuleValue(action),
    normalizeRuleValue(insight),
  ].join("|");
}

function extractRuleMetadataValue(block: string, label: string): string {
  const pattern = new RegExp(`^- ${escapeRegExp(label)}:\\s*(.+)$`, "im");
  const match = block.match(pattern);
  return match?.[1]?.trim() || "";
}

function parseRuleBlocks(markdown: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  const headerPattern = /^##\s+(rule-[^\n]+)\s*$/gim;
  const headers: Array<{ id: string; start: number; bodyStart: number }> = [];

  let match: RegExpExecArray | null = null;
  while ((match = headerPattern.exec(markdown)) !== null) {
    headers.push({
      id: match[1].trim(),
      start: match.index,
      bodyStart: headerPattern.lastIndex,
    });
  }

  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];
    const body = markdown.slice(current.bodyStart, next ? next.start : markdown.length);
    const dedupKey = extractRuleMetadataValue(body, "Dedup Key");
    const trigger = extractRuleMetadataValue(body, "Trigger");
    const action = extractRuleMetadataValue(body, "Action");
    blocks.push({ id: current.id, dedupKey, trigger, action });
  }
  return blocks;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function calculateRuleScore(params: {
  hasSource: boolean;
  hasTrigger: boolean;
  hasAction: boolean;
  conflicted: boolean;
}): number {
  let score = 40;
  if (params.hasSource) {
    score += 20;
  }
  if (params.hasTrigger) {
    score += 15;
  }
  if (params.hasAction) {
    score += 15;
  }
  if (params.conflicted) {
    score -= 30;
  }
  return clampNumber(score, 0, 100);
}

function calculateRuleConfidence(params: {
  hasSource: boolean;
  hasTrigger: boolean;
  hasAction: boolean;
  conflicted: boolean;
}): number {
  let confidence = 0.5;
  if (params.hasSource) {
    confidence += 0.1;
  }
  if (params.hasTrigger) {
    confidence += 0.1;
  }
  if (params.hasAction) {
    confidence += 0.1;
  }
  if (params.conflicted) {
    confidence -= 0.2;
  }
  const clamped = clampNumber(confidence, 0, 1);
  return Number(clamped.toFixed(2));
}

function normalizeFlowStage(input: string): FlowStageKey {
  const normalized = input.trim().toLowerCase();
  const mapped = FLOW_STAGE_ALIAS[normalized];
  if (!mapped) {
    const allowed = FLOW_STAGE_GUIDES.map((item) => item.key).join(", ");
    throw new AgentKitCliError(`Unknown stage '${input}'. Allowed stages: ${allowed}`);
  }
  return mapped;
}

function flowStageGuide(stage: FlowStageKey): FlowStageGuide {
  const found = FLOW_STAGE_GUIDES.find((item) => item.key === stage);
  if (!found) {
    throw new AgentKitCliError(`Missing stage guide configuration: ${stage}`);
  }
  return found;
}

function renderFlowNextGuideMarkdown(
  flowId: string,
  domain: string,
  owner: string,
  stageGuide: FlowStageGuide,
  flowRootRel: string,
  contextSection: string,
): string {
  const lines: string[] = [];
  lines.push(`# Stage Guide: ${stageGuide.label}`);
  lines.push("");
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- Flow ID: ${flowId}`);
  lines.push(`- Domain: ${domain}`);
  lines.push(`- Owner: ${owner}`);
  lines.push(`- Stage Key: ${stageGuide.key}`);
  lines.push(`- Flow Path: ${flowRootRel}`);
  lines.push(`- Target File: ${stageGuide.fileName}`);
  lines.push("");
  lines.push("## Required Inputs");
  lines.push("");
  for (const input of stageGuide.inputs) {
    lines.push(`- ${input}`);
  }
  lines.push("");
  lines.push("## Expected Deliverables");
  lines.push("");
  for (const item of stageGuide.deliverables) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Agent Prompt Template");
  lines.push("");
  lines.push(`You are working on flow '${flowId}' in domain '${domain}'.`);
  lines.push(`Current stage is '${stageGuide.key}', target output is '${stageGuide.fileName}'.`);
  lines.push("Read required inputs, keep compatibility constraints explicit, and produce:");
  for (const item of stageGuide.deliverables) {
    lines.push(`- ${item}`);
  }
  lines.push("When uncertain, list assumptions and blocking questions first.");
  lines.push("");
  lines.push(contextSection.trimEnd());
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function handleInit(args: string[]): void {
  let contextRepo = "";
  let contextRef = "main";
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--context-repo") {
      contextRepo = getValue(args, i, "--context-repo");
      i += 1;
      continue;
    }
    if (arg === "--context-ref") {
      contextRef = getValue(args, i, "--context-ref");
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit init [--context-repo <repo>] [--context-ref <ref>] [--force]

Options:
  --context-repo   Shared context-hub repository URL or local path.
  --context-ref    Branch/tag/commit to track (default: main).
  --force          Overwrite existing generated files.
  -h, --help       Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for init: ${arg}`);
  }

  const root = agentkitRepoRoot();
  const projectName = basename(root);
  const repoValue = contextRepo || "CHANGE_ME";
  const lockFile = join(root, "workflow", "context-hub.lock");

  mkdirSync(join(root, "workflow", "hooks"), { recursive: true });
  mkdirSync(join(root, "workflow", "sessions"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  mkdirSync(join(root, "docs", "solutions"), { recursive: true });
  mkdirSync(join(root, "docs", "reviews"), { recursive: true });
  mkdirSync(join(root, "todos"), { recursive: true });
  mkdirSync(join(root, "context"), { recursive: true });

  writeFileWithForce(
    root,
    join(root, "agentkit.config.yml"),
    "config",
    `version: 1
project:
  name: "${projectName}"
context_hub:
  lock_file: "workflow/context-hub.lock"
  repo_url: "${repoValue}"
  ref: "${contextRef}"
workflow:
  plans_dir: "docs/plans"
  solutions_dir: "docs/solutions"
  reviews_dir: "docs/reviews"
  todo_file: "todos/TODO.md"
integration:
  compound_cli: "compound"
  notes: "Override with AGENTKIT_COMPOUND_CLI if needed."
`,
    force,
  );

  if (existsSync(lockFile) && !force) {
    agentkitWarn("Skip existing lock file: workflow/context-hub.lock");
  } else {
    agentkitWriteLockFile(lockFile, repoValue, contextRef, "", "", "never");
    agentkitInfo("Wrote lock file: workflow/context-hub.lock");
  }

  writeFileWithForce(
    root,
    join(root, "context", "README.md"),
    "context guide",
    `# Context Guidance

- Keep cross-repo source of truth in \`context-hub\`.
- Keep implementation details in each service repository.
- Link to canonical docs by commit/tag, do not duplicate full content.
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "docs", "plans", "README.md"),
    "plans guide",
    `# Plans

Store requirement decomposition and implementation plans here.
Use one markdown file per requirement.
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "docs", "solutions", "README.md"),
    "solutions guide",
    `# Solutions

Store implementation outcomes, tradeoffs, and rollout notes here.
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "docs", "reviews", "README.md"),
    "reviews guide",
    `# Reviews

Store quality gate outputs and review checkpoints here.
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "todos", "TODO.md"),
    "todo list",
    `# Team TODO

## Active

## Done
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "workflow", "hooks", "README.md"),
    "hooks guide",
    `# Local Hooks

Optional executable hooks:

- \`req-dev-plan.sh\` (args: plan_file task)
- \`req-dev-work.sh\` (args: solution_file task)
- \`review.sh\` (args: review_file topic)
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "workflow", "hooks", "req-dev-plan.example.sh"),
    "hook template",
    `#!/usr/bin/env bash
set -euo pipefail
plan_file="\${1:-}"
task="\${2:-}"
printf '[hook] plan created: %s | task: %s\\n' "\${plan_file}" "\${task}"
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "workflow", "hooks", "req-dev-work.example.sh"),
    "hook template",
    `#!/usr/bin/env bash
set -euo pipefail
solution_file="\${1:-}"
task="\${2:-}"
printf '[hook] solution created: %s | task: %s\\n' "\${solution_file}" "\${task}"
`,
    force,
  );

  writeFileWithForce(
    root,
    join(root, "workflow", "hooks", "review.example.sh"),
    "hook template",
    `#!/usr/bin/env bash
set -euo pipefail
review_file="\${1:-}"
topic="\${2:-}"
printf '[hook] review created: %s | topic: %s\\n' "\${review_file}" "\${topic}"
`,
    force,
  );

  agentkitEnsureGitignoreLine(root, "workflow/cache/");
  agentkitEnsureGitignoreLine(root, "workflow/tmp/");
  agentkitEnsureGitignoreLine(root, ".DS_Store");

  agentkitInfo("Initialization complete.");
  agentkitInfo("Next steps:");
  agentkitInfo("1) Update workflow/context-hub.lock if needed.");
  agentkitInfo("2) Run 'agentkit sync-context'.");
  agentkitInfo("3) Start a ticket with 'agentkit req-dev --task \"...\"'.");
}

function handleFlowInit(args: string[]): void {
  let flowId = "";
  let title = "";
  let owner = process.env.USER || "unknown";
  let domain = "general";
  let flowDir = "docs/flows";
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      flowId = agentkitSlugify(getValue(args, i, "--id"));
      i += 1;
      continue;
    }
    if (arg === "--title") {
      title = getValue(args, i, "--title");
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      owner = getValue(args, i, "--owner");
      i += 1;
      continue;
    }
    if (arg === "--domain") {
      domain = getValue(args, i, "--domain");
      i += 1;
      continue;
    }
    if (arg === "--dir") {
      flowDir = getValue(args, i, "--dir");
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit flow-init --id <flow-id> --title <title> [--owner <name>] [--domain <domain>] [--dir <path>] [--force]

Options:
  --id         Unique flow id (for example checkout-2026q1).
  --title      Flow title.
  --owner      Flow owner (default: $USER or unknown).
  --domain     Business domain (default: general).
  --dir        Flow root directory (default: docs/flows).
  --force      Overwrite existing generated flow files.
  -h, --help   Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for flow-init: ${arg}`);
  }

  if (!flowId) {
    throw new AgentKitCliError("Flow id is required. Use '--id <flow-id>'.");
  }
  if (!title) {
    throw new AgentKitCliError("Flow title is required. Use '--title <title>'.");
  }

  const root = agentkitRepoRoot();
  const tsUtc = agentkitTimestampUtc();
  const flowRoot = join(root, flowDir, flowId);
  mkdirSync(flowRoot, { recursive: true });

  const baseMeta = `- Flow ID: ${flowId}
- Title: ${title}
- Owner: ${owner}
- Domain: ${domain}
- Updated At: ${tsUtc}`;

  const files: Array<{ name: string; content: string }> = [
    {
      name: "00-flow-overview.md",
      content: `# Flow Overview: ${title}

## Metadata

${baseMeta}

## Pipeline

1. 01-prd-source.md
2. 02-test-cases.mmd
3. 03-technical-solution.md
4. 04-api-design.md
5. 05-ui-handoff.md
6. 06-task-breakdown.yaml
7. 07-task-assignment.yaml
8. 08-delivery.md
9. 09-retro-context.md

## Status

- [ ] PRD finalized
- [ ] Test mindmap reviewed
- [ ] Technical solution approved
- [ ] API contract approved
- [ ] UI handoff approved
- [ ] Task breakdown reviewed
- [ ] Task assignment published
- [ ] Delivery merged and verified
- [ ] Experience written back to context
`,
    },
    {
      name: "01-prd-source.md",
      content: `# PRD Source: ${title}

## Metadata

${baseMeta}
- Stage: prd-source

## Source Links

- Feishu PRD: TODO
- Related ticket: TODO

## Problem Statement

- TODO

## Goals

- TODO

## Non-Goals

- TODO

## Acceptance Criteria

- TODO
`,
    },
    {
      name: "02-test-cases.mmd",
      content: `mindmap
  root((${title}))
    Happy Paths
      TODO
    Edge Cases
      TODO
    Exception Handling
      TODO
    Data Consistency
      TODO
    Security and Compliance
      TODO
`,
    },
    {
      name: "03-technical-solution.md",
      content: `# Technical Solution: ${title}

## Metadata

${baseMeta}
- Stage: technical-solution

## Inputs

- 01-prd-source.md
- 02-test-cases.mmd

## Architecture

- TODO

## Tradeoffs

- TODO

## Risks and Mitigations

- TODO
`,
    },
    {
      name: "04-api-design.md",
      content: `# API Design: ${title}

## Metadata

${baseMeta}
- Stage: api-design

## Inputs

- 03-technical-solution.md

## Contract

- Endpoint / topic: TODO
- Request schema: TODO
- Response schema: TODO

## Compatibility and Migration

- TODO

## Validation Plan

- TODO
`,
    },
    {
      name: "05-ui-handoff.md",
      content: `# UI Handoff: ${title}

## Metadata

${baseMeta}
- Stage: ui-handoff

## Inputs

- 03-technical-solution.md
- 04-api-design.md
- Design link (Figma): TODO

## Screen and State Mapping

- TODO

## Component Data Contract Mapping

- TODO

## Interaction and Accessibility Notes

- TODO
`,
    },
    {
      name: "06-task-breakdown.yaml",
      content: `meta:
  flow_id: "${flowId}"
  title: "${title}"
  owner: "${owner}"
  domain: "${domain}"
  updated_at: "${tsUtc}"
tasks:
  - id: TASK-001
    title: "Backend implementation"
    role: backend
    depends_on: []
    deliverable: "API contract and implementation PR"
    done_definition:
      - "Contract review passed"
      - "Tests added and green"
  - id: TASK-002
    title: "Frontend implementation"
    role: frontend
    depends_on: [TASK-001]
    deliverable: "UI implementation PR"
    done_definition:
      - "UI spec matched"
      - "Integration tests passed"
`,
    },
    {
      name: "07-task-assignment.yaml",
      content: `meta:
  flow_id: "${flowId}"
  title: "${title}"
  owner: "${owner}"
  domain: "${domain}"
  updated_at: "${tsUtc}"
assignments:
  - task_id: TASK-001
    assignee: "backend-owner"
    repo: "backend-repo"
    branch: "feature/${flowId}-task-001"
    input_docs:
      - "03-technical-solution.md"
      - "04-api-design.md"
    context_query:
      stage: "task-input"
      domain: "${domain}"
      tags: ["backend", "api"]
  - task_id: TASK-002
    assignee: "frontend-owner"
    repo: "frontend-repo"
    branch: "feature/${flowId}-task-002"
    input_docs:
      - "03-technical-solution.md"
      - "04-api-design.md"
      - "05-ui-handoff.md"
    context_query:
      stage: "task-input"
      domain: "${domain}"
      tags: ["frontend", "ui", "api"]
`,
    },
    {
      name: "08-delivery.md",
      content: `# Delivery Result: ${title}

## Metadata

${baseMeta}
- Stage: delivery

## Output Summary

- TODO

## Verification Evidence

- Unit test: TODO
- Integration test: TODO
- Regression test: TODO

## Release and Rollback

- TODO
`,
    },
    {
      name: "09-retro-context.md",
      content: `# Retro and Context Writeback: ${title}

## Metadata

${baseMeta}
- Stage: retro

## What Worked

- TODO

## What Failed

- TODO

## Reusable Insight Candidates

- TODO

## Writeback Commands

\`\`\`bash
agentkit capture-experience --task "${title}" --insight "<key learning>" --flow-id ${flowId} --domain ${domain} --tags "<tag1>,<tag2>" --source ${flowDir}/${flowId}/08-delivery.md
\`\`\`
`,
    },
  ];

  for (const item of files) {
    const filePath = join(flowRoot, item.name);
    writeFileWithForce(root, filePath, "flow file", item.content, force);
  }

  agentkitInfo("Flow scaffold complete.");
  agentkitInfo(`Next: agentkit flow-next --id ${flowId} --stage technical-solution --context-domain ${domain}`);
}

function handleFlowNext(args: string[]): void {
  let flowId = "";
  let stageInput = "";
  let flowDir = "docs/flows";
  let contextStageOverride = "";
  let contextDomain = "";
  let contextTags: string[] = [];
  let contextLimit = 5;
  let contextBudgetLevel: ContextBudgetLevel = "l0";
  let contextMaxTokens = 0;
  let contextIndexPath = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      flowId = agentkitSlugify(getValue(args, i, "--id"));
      i += 1;
      continue;
    }
    if (arg === "--stage") {
      stageInput = getValue(args, i, "--stage");
      i += 1;
      continue;
    }
    if (arg === "--dir") {
      flowDir = getValue(args, i, "--dir");
      i += 1;
      continue;
    }
    if (arg === "--context-stage") {
      contextStageOverride = getValue(args, i, "--context-stage");
      i += 1;
      continue;
    }
    if (arg === "--context-domain") {
      contextDomain = getValue(args, i, "--context-domain");
      i += 1;
      continue;
    }
    if (arg === "--context-tags") {
      contextTags = parseCsv(getValue(args, i, "--context-tags"));
      i += 1;
      continue;
    }
    if (arg === "--context-limit") {
      const value = Number.parseInt(getValue(args, i, "--context-limit"), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentKitCliError("--context-limit must be a positive integer.");
      }
      contextLimit = value;
      i += 1;
      continue;
    }
    if (arg === "--context-budget") {
      contextBudgetLevel = parseContextBudgetLevel(getValue(args, i, "--context-budget"));
      i += 1;
      continue;
    }
    if (arg === "--context-max-tokens") {
      const value = Number.parseInt(getValue(args, i, "--context-max-tokens"), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentKitCliError("--context-max-tokens must be a positive integer.");
      }
      contextMaxTokens = value;
      i += 1;
      continue;
    }
    if (arg === "--context-index") {
      contextIndexPath = getValue(args, i, "--context-index");
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit flow-next --id <flow-id> --stage <stage> [--dir <path>] [--context-stage <stage>] [--context-domain <domain>] [--context-tags <a,b>] [--context-limit <n>] [--context-budget <l0|l1|l2>] [--context-max-tokens <n>] [--context-index <path>]

Options:
  --id            Flow id (for example checkout-2026q1).
  --stage         Stage key or alias (prd, test, technical-solution, api, ui, task-breakdown, task-assignment, delivery, retro).
  --dir           Flow root directory (default: docs/flows).
  --context-stage Override context stage used for retrieval.
  --context-domain Context domain filter.
  --context-tags  Context tags filter (comma-separated).
  --context-limit Max retrieved context entries (default: 5).
  --context-budget Context budget level: l0|l1|l2 (default: l0).
  --context-max-tokens Override token budget for retrieval summary.
  --context-index Override context index path (default: context/index.json).
  -h, --help      Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for flow-next: ${arg}`);
  }

  if (!flowId) {
    throw new AgentKitCliError("Flow id is required. Use '--id <flow-id>'.");
  }
  if (!stageInput) {
    throw new AgentKitCliError("Stage is required. Use '--stage <stage>'.");
  }

  const stage = normalizeFlowStage(stageInput);
  const stageGuide = flowStageGuide(stage);
  const root = agentkitRepoRoot();
  const flowRoot = join(root, flowDir, flowId);
  if (!existsSync(flowRoot)) {
    throw new AgentKitCliError(`Flow not found: ${relative(root, flowRoot)}. Run 'agentkit flow-init' first.`);
  }

  const overviewFile = join(flowRoot, "00-flow-overview.md");
  let flowOwner = process.env.USER || "unknown";
  let flowDomain = "general";
  if (existsSync(overviewFile)) {
    const overview = readFileSync(overviewFile, "utf8");
    const ownerMatch = overview.match(/- Owner:\s*(.+)/);
    const domainMatch = overview.match(/- Domain:\s*(.+)/);
    if (ownerMatch?.[1]) {
      flowOwner = ownerMatch[1].trim();
    }
    if (domainMatch?.[1]) {
      flowDomain = domainMatch[1].trim();
    }
  }
  const queryDomain = contextDomain || flowDomain;
  const queryStage = contextStageOverride || stageGuide.contextStage;
  const contextIndexFile = resolve(root, contextIndexPath || join("context", "index.json"));
  const query: ContextQuery = {
    stage: queryStage || undefined,
    domain: queryDomain || undefined,
    tags: contextTags,
    limit: contextLimit,
    budgetLevel: contextBudgetLevel,
    maxTokens: contextMaxTokens || CONTEXT_BUDGET_TOKENS[contextBudgetLevel],
  };

  const contextIndex = loadContextIndex(contextIndexFile);
  const selectedContext = selectContextEntries(contextIndex.entries, query);
  const contextSection = renderContextSelectionMarkdown(contextIndexFile, query, selectedContext);
  updateContextEntryHitCount(contextIndexFile, selectedContext.selected);
  if (!existsSync(contextIndexFile)) {
    agentkitWarn(`Context index not found at ${contextIndexFile}. Run 'node scripts/build-index.mjs'.`);
  }

  const missingInputs = stageGuide.inputs
    .filter((item) => item.includes("."))
    .filter((item) => !existsSync(join(flowRoot, item)));

  const guideRel = join(flowDir, flowId, "next", `${stageGuide.key}.md`);
  const guideFile = join(root, guideRel);
  mkdirSync(join(flowRoot, "next"), { recursive: true });
  const guideContent = renderFlowNextGuideMarkdown(
    flowId,
    flowDomain,
    flowOwner,
    stageGuide,
    relative(root, flowRoot),
    contextSection,
  );
  writeFileSync(guideFile, guideContent, "utf8");

  agentkitInfo(`Created: ${guideRel}`);
  agentkitInfo(
    `Context references: ${selectedContext.selected.length} (matched=${selectedContext.matched_total}, budget=${query.maxTokens}t)`,
  );
  if (missingInputs.length > 0) {
    for (const input of missingInputs) {
      agentkitWarn(`Missing stage input file: ${relative(root, join(flowRoot, input))}`);
    }
  }
}

function handleSyncContext(args: string[]): void {
  let repoOverride = "";
  let refOverride = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--context-repo") {
      repoOverride = getValue(args, i, "--context-repo");
      i += 1;
      continue;
    }
    if (arg === "--context-ref") {
      refOverride = getValue(args, i, "--context-ref");
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit sync-context [--context-repo <repo>] [--context-ref <ref>]

Options:
  --context-repo   Override context repo URL/path and persist it.
  --context-ref    Override context ref (branch/tag/commit) and persist it.
  -h, --help       Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for sync-context: ${arg}`);
  }

  const root = agentkitRepoRoot();
  agentkitRequireInitialized(root);

  const lockFile = join(root, "workflow", "context-hub.lock");
  let repo = agentkitReadLockValue(lockFile, "CONTEXT_REPO_URL");
  let ref = agentkitReadLockValue(lockFile, "CONTEXT_REF");

  if (repoOverride) {
    repo = repoOverride;
  }
  if (refOverride) {
    ref = refOverride;
  }
  if (!ref) {
    ref = "main";
  }
  if (!repo) {
    throw new AgentKitCliError("No context repo configured. Run 'agentkit init --context-repo <repo>'.");
  }

  let resolved = "";
  let status = "unverified";

  if (repo === "CHANGE_ME") {
    status = "missing-config";
  } else {
    const expandedRepo = expandUserPath(repo);
    const repoPath = resolve(root, expandedRepo);
    const localHint =
      existsSync(repoPath) ||
      isAbsolute(expandedRepo) ||
      expandedRepo.startsWith("./") ||
      expandedRepo.startsWith("../");

    if (localHint && !looksLikeRemoteRepo(expandedRepo)) {
      if (existsSync(join(repoPath, ".git"))) {
        const probe = runCommand(
          "git",
          ["-C", repoPath, "rev-parse", "--verify", `${ref}^{commit}`],
          { allowFailure: true },
        );
        if (probe.status === 0) {
          resolved = probe.stdout.trim();
          status = "verified-local";
        } else {
          status = "invalid-local-ref";
        }
      } else {
        status = "missing-local-repo";
      }
    } else {
      const probe = runCommand(
        "git",
        ["ls-remote", repo, ref, `refs/heads/${ref}`, `refs/tags/${ref}`],
        { allowFailure: true },
      );
      if (probe.status === 0) {
        const firstLine = probe.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (firstLine) {
          resolved = firstLine.split(/\s+/)[0] ?? "";
          status = resolved ? "verified-remote" : "unresolved-remote-ref";
        } else {
          status = "unresolved-remote-ref";
        }
      } else {
        const connectivity = runCommand("git", ["ls-remote", repo], { allowFailure: true });
        status = connectivity.status === 0 ? "unresolved-remote-ref" : "remote-check-failed";
      }
    }
  }

  const now = agentkitTimestampUtc();
  agentkitWriteLockFile(lockFile, repo, ref, resolved, now, status);

  agentkitInfo("Updated workflow/context-hub.lock");
  agentkitInfo(`repo: ${repo}`);
  agentkitInfo(`ref: ${ref}`);
  agentkitInfo(`status: ${status}`);
  if (resolved) {
    agentkitInfo(`resolved: ${resolved}`);
  }
  if (status !== "verified-local" && status !== "verified-remote") {
    agentkitWarn("Context sync is not fully verified. Check repository accessibility or ref correctness.");
  }
}

function handleBind(args: string[]): void {
  let contextRootInput = "";
  let repoKeyInput = "";
  let requirementIdInput = "";
  let workspacePathInput = "";
  let show = false;
  let global = false;
  let globalOnly = false;
  let gitConfigOnly = false;
  let fileOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--context-root") {
      contextRootInput = getValue(args, i, "--context-root");
      i += 1;
      continue;
    }
    if (arg === "--repo-key") {
      repoKeyInput = getValue(args, i, "--repo-key").trim();
      i += 1;
      continue;
    }
    if (arg === "--req-id") {
      requirementIdInput = smartSlug(getValue(args, i, "--req-id"), "req");
      i += 1;
      continue;
    }
    if (arg === "--workspace-path") {
      workspacePathInput = getValue(args, i, "--workspace-path").trim();
      i += 1;
      continue;
    }
    if (arg === "--show") {
      show = true;
      continue;
    }
    if (arg === "--global") {
      global = true;
      continue;
    }
    if (arg === "--global-only") {
      globalOnly = true;
      continue;
    }
    if (arg === "--git-config-only") {
      gitConfigOnly = true;
      continue;
    }
    if (arg === "--file-only") {
      fileOnly = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit bind [--context-root <path>] [--repo-key <repo-key>] [--req-id <requirement-id>] [--workspace-path <path>] [--show] [--global|--global-only] [--git-config-only|--file-only]

Options:
  (no args)       If current repo is context repo, auto write global bind (~/.agentkit/config.json).
  --context-root   Context-engineering repository root path.
  --repo-key       Repo key in requirements/repo-links.yml (for example backend / canvas-fe).
  --req-id         Default active requirement id.
  --workspace-path Register/update user-local workspace override for the repo key.
  --show           Show resolved binding (git config -> bind.local.json -> global config -> env).
  --global         Also write global bind file (~/.agentkit/config.json).
  --global-only    Only write global bind file (no repo-local bind).
  --git-config-only Only update .git/config local keys (do not write bind.local.json).
  --file-only      Only update .agentkit/bind.local.json (do not write git local config).
  -h, --help       Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for bind: ${arg}`);
  }

  if (gitConfigOnly && fileOnly) {
    throw new AgentKitCliError("--git-config-only and --file-only cannot be used together.");
  }
  if (globalOnly && (gitConfigOnly || fileOnly)) {
    throw new AgentKitCliError("--global-only cannot be combined with --git-config-only or --file-only.");
  }

  const repoRoot = agentkitRepoRoot();
  const isContextRepo = looksLikeContextRepoRoot(repoRoot);
  const noArgsBind =
    !show &&
    !contextRootInput &&
    !repoKeyInput &&
    !requirementIdInput &&
    !workspacePathInput &&
    !global &&
    !globalOnly &&
    !gitConfigOnly &&
    !fileOnly;
  if (noArgsBind) {
    if (isContextRepo) {
      globalOnly = true;
      contextRootInput = repoRoot;
      agentkitInfo("No options provided. Using default global bind from current context repository.");
    } else {
      throw new AgentKitCliError(
        "No binding inputs provided. Run in context repo with 'agentkit bind', or specify --context-root <path>, or use --show.",
      );
    }
  }

  const localBind = readLocalBindConfig(repoRoot);
  const globalBind = readGlobalBindConfig();
  const writeLocalScope = !globalOnly;
  const writeGlobalScope = global || globalOnly;

  const hasWriteInputs = Boolean(
    contextRootInput || repoKeyInput || requirementIdInput || workspacePathInput || writeGlobalScope,
  );
  if (!hasWriteInputs && !show) {
    throw new AgentKitCliError(
      "No binding inputs provided. Use --show or set --context-root/--repo-key/--req-id/--workspace-path/--global.",
    );
  }

  if (hasWriteInputs) {
    let resolvedContextRoot = localBind.context_root || globalBind.context_root || "";
    if (contextRootInput) {
      resolvedContextRoot = resolveContextRootPath(repoRoot, contextRootInput);
    } else if (writeGlobalScope && looksLikeContextRepoRoot(repoRoot)) {
      // Bootstrap in context repo when context root is omitted.
      resolvedContextRoot = repoRoot;
    }
    let resolvedRepoKey = repoKeyInput || localBind.repo_key || readProjectRepoKey(repoRoot) || "";
    if (!resolvedRepoKey && resolvedContextRoot && !isContextRepo) {
      resolvedRepoKey = inferRepoKeyForWorkspace(repoRoot, resolvedContextRoot);
    }
    const resolvedReqId = requirementIdInput || localBind.active_requirement_id || "";
    let resolvedWorkspacePath = "";
    if (workspacePathInput) {
      const candidate = resolveOptionalLocalPath(repoRoot, workspacePathInput);
      if (!candidate) {
        throw new AgentKitCliError(`Workspace path does not exist: ${workspacePathInput}`);
      }
      resolvedWorkspacePath = candidate;
    } else if (!isContextRepo && resolvedRepoKey) {
      resolvedWorkspacePath = repoRoot;
    }

    if (writeLocalScope) {
      if (!fileOnly) {
        if (resolvedContextRoot) {
          writeGitLocalConfig(repoRoot, "agentkit.contextRoot", resolvedContextRoot);
        }
        if (resolvedRepoKey) {
          writeGitLocalConfig(repoRoot, "agentkit.repoKey", resolvedRepoKey);
        }
        if (resolvedReqId) {
          writeGitLocalConfig(repoRoot, "agentkit.activeRequirement", resolvedReqId);
        }
      }
      if (!gitConfigOnly) {
        agentkitEnsureGitignoreLine(repoRoot, ".agentkit/bind.local.json");
        const bindFile = writeLocalBindConfig(repoRoot, {
          context_root: resolvedContextRoot || undefined,
          repo_key: resolvedRepoKey || undefined,
          active_requirement_id: resolvedReqId || undefined,
        });
        agentkitInfo(`Updated local bind file: ${relative(repoRoot, bindFile)}`);
      }
    }

    if (resolvedWorkspacePath && !resolvedRepoKey) {
      throw new AgentKitCliError("Workspace override requires repo key. Use --repo-key or bind a repo that can be inferred.");
    }

    if (resolvedWorkspacePath && resolvedRepoKey) {
      const nextGlobalBind = readGlobalBindConfig();
      const workspaceGlobalFile = writeGlobalBindConfig({
        ...nextGlobalBind,
        context_root: writeGlobalScope
          ? resolvedContextRoot || nextGlobalBind.context_root
          : nextGlobalBind.context_root || resolvedContextRoot || undefined,
        workspace_overrides: {
          ...(nextGlobalBind.workspace_overrides || {}),
          [resolvedRepoKey]: resolvedWorkspacePath,
        },
      });
      agentkitInfo(`Registered workspace override: ${resolvedRepoKey} -> ${resolvedWorkspacePath}`);
      agentkitInfo(`Updated global bind file: ${workspaceGlobalFile}`);
    }

    if (writeGlobalScope) {
      if (!resolvedContextRoot) {
        throw new AgentKitCliError(
          "Global bind requires context root. Use --context-root <path> or run inside context repository.",
        );
      }
      const globalFile = writeGlobalBindConfig({
        ...readGlobalBindConfig(),
        context_root: resolvedContextRoot,
      });
      agentkitInfo(`Updated global bind file: ${globalFile}`);
    }
  }

  if (show || hasWriteInputs) {
    const gitContextRoot = readGitLocalConfig(repoRoot, "agentkit.contextRoot");
    const gitRepoKey = readGitLocalConfig(repoRoot, "agentkit.repoKey");
    const gitReqId = readGitLocalConfig(repoRoot, "agentkit.activeRequirement");
    const latestLocalBind = readLocalBindConfig(repoRoot);
    const latestGlobalBind = readGlobalBindConfig();
    const envContextRoot = (process.env.AGENTKIT_CONTEXT_ROOT || "").trim();
    const projectRepoKey = readProjectRepoKey(repoRoot);

    let resolvedContextRoot = "";
    let contextSource = "";
    const bound = resolveBoundContextRoot(repoRoot);
    if (bound) {
      resolvedContextRoot = bound.path;
      contextSource = bound.source;
    }

    const resolvedRepoKey = gitRepoKey || latestLocalBind.repo_key || projectRepoKey;
    const repoKeySource = gitRepoKey
      ? "git-config"
      : latestLocalBind.repo_key
        ? "bind.local.json"
        : projectRepoKey
          ? "project.json"
          : "";
    const resolvedReqId = gitReqId || latestLocalBind.active_requirement_id || "";
    const reqSource = gitReqId ? "git-config" : latestLocalBind.active_requirement_id ? "bind.local.json" : "";
    const currentWorkspace = resolvedRepoKey ? latestGlobalBind.workspace_overrides?.[resolvedRepoKey] || "" : "";

    agentkitInfo(`Repo root: ${repoRoot}`);
    agentkitInfo(`Context root: ${resolvedContextRoot || "N/A"}${contextSource ? ` (source=${contextSource})` : ""}`);
    agentkitInfo(`Repo key: ${resolvedRepoKey || "N/A"}${repoKeySource ? ` (source=${repoKeySource})` : ""}`);
    agentkitInfo(`Active requirement: ${resolvedReqId || "N/A"}${reqSource ? ` (source=${reqSource})` : ""}`);
    agentkitInfo(`Global context root: ${latestGlobalBind.context_root || "N/A"}`);
    agentkitInfo(`Workspace override: ${currentWorkspace || "N/A"}`);
    agentkitInfo(`Workspace overrides registered: ${Object.keys(latestGlobalBind.workspace_overrides || {}).length}`);
    if (!resolvedContextRoot) {
      agentkitWarn("Context root is not bound. Run `agentkit bind` in context repository, or set --context-root <path>.");
    }
    if (!gitContextRoot && !latestLocalBind.context_root && envContextRoot) {
      agentkitInfo(`Env fallback AGENTKIT_CONTEXT_ROOT: ${envContextRoot}`);
    }
  }
}

function looksLikeLocalSource(source: string): boolean {
  if (source === "~" || source.startsWith("~/")) {
    return true;
  }
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
    return true;
  }
  return existsSync(expandUserPath(source));
}

function defaultServiceNameFromSource(source: string): string {
  const cleaned = source
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const base = cleaned.split("/").pop() || cleaned;
  return smartSlug(base, "service");
}

function listTopLevelEntries(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .slice(0, 20)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  return entries;
}

function detectServiceTags(servicePath: string): string[] {
  const tags: string[] = [];
  const add = (tag: string): void => {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  };
  const has = (fileName: string): boolean => existsSync(join(servicePath, fileName));

  if (has("package.json")) {
    add("node");
    try {
      const pkg = JSON.parse(readFileSync(join(servicePath, "package.json"), "utf8")) as Record<string, unknown>;
      const deps = {
        ...(pkg.dependencies && typeof pkg.dependencies === "object" ? (pkg.dependencies as Record<string, unknown>) : {}),
        ...(pkg.devDependencies && typeof pkg.devDependencies === "object" ? (pkg.devDependencies as Record<string, unknown>) : {}),
      };
      const depKeys = Object.keys(deps).map((item) => item.toLowerCase());
      if (depKeys.some((item) => item.includes("react"))) {
        add("react");
        add("frontend");
      }
      if (depKeys.some((item) => item.includes("vue"))) {
        add("vue");
        add("frontend");
      }
      if (depKeys.some((item) => item.includes("nuxt"))) {
        add("nuxt");
      }
      if (depKeys.some((item) => item.includes("next"))) {
        add("nextjs");
      }
      if (depKeys.some((item) => item.includes("vite"))) {
        add("vite");
      }
      if (depKeys.some((item) => item.includes("express") || item.includes("koa") || item.includes("fastify"))) {
        add("backend");
      }
    } catch {
      // ignore parse failure
    }
  }
  if (has("pnpm-lock.yaml")) {
    add("pnpm");
  }
  if (has("yarn.lock")) {
    add("yarn");
  }
  if (has("package-lock.json")) {
    add("npm");
  }
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) {
    add("java");
    add("backend");
  }
  if (has("go.mod")) {
    add("go");
    add("backend");
  }
  if (has("Cargo.toml")) {
    add("rust");
    add("backend");
  }
  if (has("requirements.txt") || has("pyproject.toml")) {
    add("python");
    add("backend");
  }
  if (has("Dockerfile") || has("docker-compose.yml")) {
    add("docker");
  }
  if (!tags.includes("frontend") && !tags.includes("backend")) {
    add("service");
  }
  return tags;
}

function renderTagsForFrontmatter(tags: string[]): string {
  if (tags.length === 0) {
    return "[]";
  }
  return `[${tags.join(", ")}]`;
}

function analyzeServiceContextMarkdown(params: {
  serviceName: string;
  sourceLabel: string;
  branch: string;
  analyzedPath: string;
  tags: string[];
}): string {
  const topEntries = listTopLevelEntries(params.analyzedPath);
  const datePart = new Date().toISOString().slice(0, 10);
  const entryLines = topEntries.length > 0 ? topEntries.map((item) => `- ${item}`).join("\n") : "- (no visible entries)";
  const stackLines = params.tags.length > 0 ? params.tags.map((item) => `- ${item}`).join("\n") : "- unknown";
  const backendChecklist = params.tags.includes("backend")
    ? `
## 后端补充检查（首次生成后应立即人工补全）

- 数据库访问方式与 schema / migration / 生成代码入口
- 与当前业务最相关的关键表、聚合根、JSON 配置字段
- 已有关键写链路 / 复制链路 / 发布链路 / 审核链路
- 可复用的 Domain Service / Manager / Validator / Assembler
- 权限、只读、副本、版本切换、历史记录等强约束落点

> 如果这里不补关键表和既有链路，design 阶段会把后端误判成白板实现。
`
    : "";

  return `---
service: ${params.serviceName}
repo: ${params.sourceLabel}
local_path: ${params.analyzedPath}
analyzed_at: ${datePart}
tags: ${renderTagsForFrontmatter(params.tags)}
---

# ${params.serviceName} 服务上下文

## 来源

- Source: ${params.sourceLabel}
- Branch: ${params.branch || "N/A"}
- Analyzed Path: ${params.analyzedPath}

## 技术栈信号

${stackLines}

## 目录概览（Top Level）

${entryLines}

## 建议关注

- 核心入口文件与路由定义
- API 接口层与请求/响应约定
- 状态管理、鉴权、错误处理链路
- 测试/构建/发布脚本与约束
${backendChecklist}`;
}

function handleLoadService(args: string[]): void {
  let source = "";
  let branch = "";
  let serviceName = "";
  let force = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--branch") {
      branch = getValue(args, i, "--branch");
      i += 1;
      continue;
    }
    if (arg === "--name") {
      serviceName = smartSlug(getValue(args, i, "--name"), "service");
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit load-service <source> [--branch <branch>] [--name <service-name>] [--force]

Options:
  <source>       Local path or git repository URL.
  --branch       Branch name when source is remote.
  --name         Output service name (default: derived from source).
  --force        Overwrite existing context file.
  -h, --help     Show this help message.`);
      return;
    }
    if (arg.startsWith("-")) {
      throw new AgentKitCliError(`Unknown option for load-service: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    source = positional[0];
  }
  if (!source) {
    throw new AgentKitCliError("Source is required. Use 'agentkit load-service <source>'.");
  }
  if (!serviceName) {
    serviceName = defaultServiceNameFromSource(source);
  }

  const root = agentkitRepoRoot();
  const isLocal = looksLikeLocalSource(source);
  let analyzedPath = "";
  let sourceLabel = source;
  let checkoutBranch = branch;

  if (isLocal) {
    const expanded = expandUserPath(source);
    analyzedPath = resolve(root, expanded);
    if (!existsSync(analyzedPath)) {
      throw new AgentKitCliError(`Local source path does not exist: ${analyzedPath}`);
    }
    if (!checkoutBranch && existsSync(join(analyzedPath, ".git"))) {
      const branchProbe = runCommand("git", ["-C", analyzedPath, "rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
      if (branchProbe.status === 0) {
        checkoutBranch = branchProbe.stdout.trim();
      }
    }
    sourceLabel = analyzedPath;
  } else {
    const cacheDir = join(root, "workflow", "cache", "workspaces", "loadservice", serviceName);
    mkdirSync(dirname(cacheDir), { recursive: true });
    if (existsSync(join(cacheDir, ".git"))) {
      runCommand("git", ["-C", cacheDir, "fetch", "--all", "--prune"], { allowFailure: true });
      if (checkoutBranch) {
        runCommand("git", ["-C", cacheDir, "checkout", checkoutBranch], { allowFailure: true });
      }
      runCommand("git", ["-C", cacheDir, "pull", "--ff-only"], { allowFailure: true });
    } else {
      const cloneArgs = ["clone", "--depth", "1"];
      if (checkoutBranch) {
        cloneArgs.push("--branch", checkoutBranch);
      }
      cloneArgs.push(source, cacheDir);
      runCommand("git", cloneArgs);
    }
    analyzedPath = cacheDir;
    if (!checkoutBranch) {
      const branchProbe = runCommand("git", ["-C", analyzedPath, "rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
      if (branchProbe.status === 0) {
        checkoutBranch = branchProbe.stdout.trim();
      }
    }
  }

  const tags = detectServiceTags(analyzedPath);
  let registeredRepoKey = "";
  if (isLocal) {
    registeredRepoKey = inferRepoKeyForLocalWorkspace(root, analyzedPath, serviceName);
    if (registeredRepoKey) {
      const repoLinks = readRepoLinks(join(root, "requirements", "repo-links.yml"));
      const registration = upsertGlobalWorkspaceOverride(registeredRepoKey, analyzedPath, root);
      if (registration.changed) {
        agentkitInfo(`Updated global bind file: ${registration.filePath}`);
      }
      agentkitInfo(`Registered workspace override: ${registeredRepoKey} -> ${analyzedPath}`);
      const expectedRepoUrl = repoLinks[registeredRepoKey] || "";
      const remoteMatched = workspacePathMatchesRepoLink(root, expectedRepoUrl, analyzedPath);
      if (remoteMatched === false) {
        agentkitWarn(
          `Local source path does not match repo-links entry for '${registeredRepoKey}' (${expectedRepoUrl}). Verify the selected repository path.`,
        );
      }
    }
  }

  const serviceFile = join(root, "context", "tech", "services", `${serviceName}.md`);
  const serviceFileExists = existsSync(serviceFile);
  if (serviceFileExists && !force) {
    agentkitWarn(`Service context already exists: ${relative(root, serviceFile)}. Keeping existing file (use --force to refresh).`);
  } else {
    mkdirSync(dirname(serviceFile), { recursive: true });
    const markdown = analyzeServiceContextMarkdown({
      serviceName,
      sourceLabel,
      branch: checkoutBranch,
      analyzedPath,
      tags,
    });
    writeFileSync(serviceFile, markdown, "utf8");
    maybeRebuildContextIndex(root);
    agentkitInfo(`Service context written: ${relative(root, serviceFile)}`);
  }
  agentkitInfo(`Source: ${sourceLabel}`);
  if (checkoutBranch) {
    agentkitInfo(`Branch: ${checkoutBranch}`);
  }
  agentkitInfo(`Tags: ${tags.join(", ") || "N/A"}`);
  if (!registeredRepoKey && isLocal) {
    agentkitWarn("Workspace override was not registered automatically. Ensure --name matches the repo key in requirements/repo-links.yml if you want req-dev to use this local path later.");
  }
}

async function handleReqDev(args: string[]): Promise<void> {
  let task = "";
  let requirementId = "";
  let taskId = "";
  let owner = process.env.USER || "unknown";
  let domain = "general";
  let prdLink = "";
  let allowEmptyPrd = false;
  let prdExtractMode: FeishuExtractMode = "both";
  let force = false;
  let frontendRepo = "";
  let backendRepo = "";
  let contextStage = "task-input";
  let contextDomain = "";
  let contextTags: string[] = [];
  let contextLimit = 5;
  let contextBudgetLevel: ContextBudgetLevel = "l0";
  let contextMaxTokens = 0;
  let contextRootOverride = "";
  let contextIndexPath = "";
  let checkOnly = false;
  let transitionSpec = "";
  let overrideReason = "";
  let reviewTarget = "";
  let reviewApproved = true;
  let reviewNotes = "";
  let reviewReviewer = "";
  let dispatchSubagents = false;
  let interactiveMode = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--task") {
      task = getValue(args, i, "--task");
      i += 1;
      continue;
    }
    if (arg === "--id") {
      requirementId = smartSlug(getValue(args, i, "--id"), "req");
      i += 1;
      continue;
    }
    if (arg === "--task-id") {
      taskId = getValue(args, i, "--task-id").trim().toUpperCase();
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      owner = getValue(args, i, "--owner");
      i += 1;
      continue;
    }
    if (arg === "--domain") {
      domain = getValue(args, i, "--domain");
      i += 1;
      continue;
    }
    if (arg === "--prd-link") {
      prdLink = getValue(args, i, "--prd-link");
      i += 1;
      continue;
    }
    if (arg === "--allow-empty-prd") {
      allowEmptyPrd = true;
      continue;
    }
    if (arg === "--prd-extract-mode") {
      prdExtractMode = parseFeishuExtractMode(getValue(args, i, "--prd-extract-mode"));
      i += 1;
      continue;
    }
    if (arg === "--frontend-repo") {
      frontendRepo = getValue(args, i, "--frontend-repo");
      i += 1;
      continue;
    }
    if (arg === "--backend-repo") {
      backendRepo = getValue(args, i, "--backend-repo");
      i += 1;
      continue;
    }
    if (arg === "--context-stage") {
      contextStage = getValue(args, i, "--context-stage");
      i += 1;
      continue;
    }
    if (arg === "--context-domain") {
      contextDomain = getValue(args, i, "--context-domain");
      i += 1;
      continue;
    }
    if (arg === "--context-tags") {
      contextTags = parseCsv(getValue(args, i, "--context-tags"));
      i += 1;
      continue;
    }
    if (arg === "--context-limit") {
      const value = Number.parseInt(getValue(args, i, "--context-limit"), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentKitCliError("--context-limit must be a positive integer.");
      }
      contextLimit = value;
      i += 1;
      continue;
    }
    if (arg === "--context-budget") {
      contextBudgetLevel = parseContextBudgetLevel(getValue(args, i, "--context-budget"));
      i += 1;
      continue;
    }
    if (arg === "--context-max-tokens") {
      const value = Number.parseInt(getValue(args, i, "--context-max-tokens"), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentKitCliError("--context-max-tokens must be a positive integer.");
      }
      contextMaxTokens = value;
      i += 1;
      continue;
    }
    if (arg === "--context-index") {
      contextIndexPath = getValue(args, i, "--context-index");
      i += 1;
      continue;
    }
    if (arg === "--context-root") {
      contextRootOverride = getValue(args, i, "--context-root");
      i += 1;
      continue;
    }
    if (arg === "--dispatch-subagents") {
      dispatchSubagents = true;
      continue;
    }
    if (arg === "--interactive") {
      interactiveMode = true;
      continue;
    }
    if (arg === "--check-only") {
      checkOnly = true;
      continue;
    }
    if (arg === "--transition") {
      transitionSpec = getValue(args, i, "--transition");
      i += 1;
      continue;
    }
    if (arg === "--override-with-reason") {
      overrideReason = getValue(args, i, "--override-with-reason");
      i += 1;
      continue;
    }
    if (arg === "--review") {
      reviewTarget = getValue(args, i, "--review").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--approved") {
      const value = getValue(args, i, "--approved").trim().toLowerCase();
      if (value !== "true" && value !== "false") {
        throw new AgentKitCliError("--approved must be true or false.");
      }
      reviewApproved = value === "true";
      i += 1;
      continue;
    }
    if (arg === "--reviewer") {
      reviewReviewer = getValue(args, i, "--reviewer").trim();
      i += 1;
      continue;
    }
    if (arg === "--notes") {
      reviewNotes = getValue(args, i, "--notes");
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit req-dev --task <text> [--id <requirement-id>] [--task-id <task-id>] [--owner <name>] [--domain <domain>] [--prd-link <url>] [--allow-empty-prd] [--prd-extract-mode <raw|rich|both>] [--frontend-repo <url>] [--backend-repo <url>] [--context-stage <stage>] [--context-domain <domain>] [--context-tags <a,b>] [--context-limit <n>] [--context-budget <l0|l1|l2>] [--context-max-tokens <n>] [--context-index <path>] [--context-root <path>] [--force]
  agentkit req-dev --prd-link <feishu-url> [--id <requirement-id>] [--frontend-repo <url>] [--backend-repo <url>]
  agentkit req-dev --id <requirement-id> --transition <from:to> [--check-only] [--override-with-reason <text>]
  agentkit req-dev --id <requirement-id> --review <intake|design> [--approved <true|false>] [--reviewer <name>] [--notes <text>]
  agentkit req-dev --id <requirement-id> --dispatch-subagents
  agentkit req-dev [--interactive]
  agentkit req-dev <free form requirement text | req-id | task-id>

Options:
  --task          Requirement title or short description.
  --id            Requirement id (default: req-yyyymmdd-<slug>).
  --task-id       Task id from 06-task-assignment.yaml (for example TASK-001).
  --owner         Requirement owner (default: $USER or unknown).
  --domain        Domain (default: general).
  --prd-link      Feishu PRD link (/docx/<token> or /wiki/<token>).
  --allow-empty-prd Continue even if PRD fetch fails (manual fill required).
  --prd-extract-mode PRD extract mode: raw | rich | both (default: both).
  --frontend-repo Frontend repository URL/path.
  --backend-repo  Backend repository URL/path.
  --context-stage Context stage filter (default: task-input).
  --context-domain Context domain filter.
  --context-tags  Context tags filter (comma-separated).
  --context-limit Max retrieved context entries (default: 5).
  --context-budget Context budget level: l0|l1|l2 (default: l0).
  --context-max-tokens Override token budget for retrieval summary.
  --context-index Override context index path (default: context/index.json).
  --context-root  Context repository root (default: auto resolve from local bind/global config/env/current repo).
  --check-only    Only run gate checks for the specified transition.
  --transition    Requirement state transition (for example design:implementing).
  --override-with-reason Force transition when gate fails, with audit reason.
  --review        Write review result file: intake or design.
  --approved      Review approval flag for --review (true|false, default: true).
  --reviewer      Reviewer name in review file.
  --notes         Notes in review file.
  --dispatch-subagents Generate sub-agent parallel dispatch artifacts from task-input files.
  --interactive   Guided mode: ask questions based on current phase and missing info.
  --force         Overwrite existing files for the requirement.
  -h, --help      Show this help message.`);
      return;
    }
    positional.push(arg);
  }

  if (!task && positional.length > 0) {
    if (positional.length === 1) {
      const only = positional[0].trim();
      if (!requirementId && /^req-/i.test(only)) {
        requirementId = smartSlug(only, "req");
      } else if (!taskId && /^task-/i.test(only)) {
        taskId = only.toUpperCase();
      } else {
        task = only;
      }
    } else {
      task = positional.join(" ");
    }
  }

  const ttyInteractive = canUseInteractivePrompt();
  if (interactiveMode && !ttyInteractive) {
    throw new AgentKitCliError("--interactive requires a TTY terminal.");
  }
  const interactiveEnabled = ttyInteractive && interactiveMode;

  const runtimeRoot = agentkitRepoRoot();
  const resolvedRoot = resolveReqDevRoot(runtimeRoot, contextRootOverride);
  const root = resolvedRoot.path;
  const runtimeIsContextRepo = looksLikeContextRepoRoot(runtimeRoot);
  if (!runtimeIsContextRepo && resolvedRoot.source === "repo-root-fallback") {
    throw new AgentKitCliError(
      "Context root is not configured for this repository. Run `npm run init` in your local agent-project-kit repository first, or bind this repo with `agentkit bind --context-root <path>`.",
    );
  }
  if (runtimeRoot !== root) {
    agentkitInfo(`Using context root: ${root} (source=${resolvedRoot.source})`);
  } else if (resolvedRoot.source === "repo-root-fallback") {
    agentkitWarn(`Using fallback context root: ${root} (source=${resolvedRoot.source})`);
  }
  ensureSpeckitLiteStructure(root);
  const codeRepoMode = !runtimeIsContextRepo;
  const currentRepoKey = codeRepoMode ? resolveRuntimeRepoKey(runtimeRoot, root) : "";
  if (codeRepoMode) {
    if (currentRepoKey) {
      updateWorkspaceOverrideForRuntimeRepo(runtimeRoot, root, currentRepoKey);
      agentkitInfo(`Resolved current repo key: ${currentRepoKey}`);
    } else {
      agentkitWarn(
        "Could not infer current repo key from git remotes. Use `agentkit bind --repo-key <repo-key>` in this repository to make repo-scoped task lookup deterministic.",
      );
    }
  }

  if (!task && !requirementId && !taskId && !prdLink) {
    if (interactiveEnabled) {
      const selected = await promptRequirementChoice(root);
      if (!selected.createNew && selected.requirementId) {
        requirementId = selected.requirementId;
      } else {
        const freeInput = await promptLine("Describe requirement in natural language, or paste Feishu PRD link");
        if (/https?:\/\/\S+/i.test(freeInput) && /(feishu\.cn|larksuite\.com)/i.test(freeInput)) {
          prdLink = freeInput.trim();
        } else {
          task = freeInput.trim();
        }
      }
    } else if (codeRepoMode) {
      if (!currentRepoKey) {
        throw new AgentKitCliError(
          "Current repository does not map to any repo key. Run `agentkit bind --repo-key <repo-key>` in this repository first.",
        );
      }
      const candidates = listInProgressRepoTaskCandidates(root, currentRepoKey);
      if (candidates.length === 0) {
        throw new AgentKitCliError(`No in-progress tasks found for repo '${currentRepoKey}'.`);
      }
      if (candidates.length === 1) {
        agentkitInfo("Resolved single repo task candidate:");
        for (const line of renderRepoTaskCandidate(candidates[0], root)) {
          agentkitInfo(line);
        }
        agentkitInfo("Confirm with the user before implementation.");
        return;
      }
      printRepoTaskCandidates(`Found ${candidates.length} in-progress task candidates for repo '${currentRepoKey}':`, candidates, root);
      agentkitInfo("Ask the user which task to implement, then rerun with --task-id or --id.");
      return;
    } else {
      const inProgressChoices = listInProgressRequirementChoices(root);
      if (inProgressChoices.length === 1) {
        requirementId = inProgressChoices[0].requirementId;
        agentkitInfo(`Auto-selected in-progress requirement: ${requirementId}`);
      } else if (inProgressChoices.length > 1) {
        const tip = inProgressChoices
          .slice(0, 5)
          .map((item) => item.requirementId)
          .join(", ");
        throw new AgentKitCliError(
          `Multiple in-progress requirements found. Use '--id <requirement-id>' or run in TTY interactive mode. Candidates: ${tip}`,
        );
      }
    }
  }

  if (prdLink) {
    const envLoad = maybeLoadReqDevFeishuEnv(root);
    if (envLoad.loadedFiles.length > 0) {
      const relFiles = envLoad.loadedFiles.map((file) => relative(root, file) || file).join(", ");
      const loadedKeys = envLoad.loadedKeys.length > 0 ? envLoad.loadedKeys.join(", ") : "none";
      agentkitInfo(`Loaded env from ${relFiles} (keys: ${loadedKeys})`);
    }
  }

  let prdSource: FeishuPrdSource | null = null;
  let prdFetchError = "";
  if (prdLink) {
    try {
      prdSource = fetchFeishuPrdSource(prdLink, prdExtractMode);
      if (!task) {
        task = prdSource.title;
      }
    } catch (error) {
      prdFetchError = error instanceof Error ? error.message : String(error);
      if (!allowEmptyPrd) {
        throw new AgentKitCliError(
          `Failed to fetch PRD from Feishu. ${prdFetchError}. Use --allow-empty-prd to continue with manual intake.`,
        );
      }
      if (!task) {
        throw new AgentKitCliError(
          `Failed to fetch PRD from Feishu and no task title was provided. ${prdFetchError}. ` +
            "When using --allow-empty-prd, you must pass --task with a semantic title so req-id stays readable.",
        );
      }
      agentkitWarn(`Failed to fetch PRD from Feishu: ${prdFetchError}`);
    }
  }

  if (!task && !requirementId && !taskId) {
    throw new AgentKitCliError(
      "Task is required. Use '--task <text>', '--task-id <task-id>', positional text, '--prd-link <url>', or '--interactive'.",
    );
  }

  if (reviewTarget) {
    if (!requirementId) {
      throw new AgentKitCliError("Requirement id is required for review writeback. Use '--id <requirement-id>'.");
    }
    if (reviewTarget !== "intake" && reviewTarget !== "design") {
      throw new AgentKitCliError("--review must be intake or design.");
    }
    const reqLookup = findRequirementDir(root, requirementId);
    const reviewFileName = reviewTarget === "intake" ? ".review-intake.json" : ".review-design.json";
    const reviewFile = join(reqLookup.dir, reviewFileName);
    const payload = {
      reviewer: reviewReviewer || owner || process.env.USER || "unknown",
      approved: reviewApproved,
      notes: reviewNotes || "",
      timestamp: agentkitTimestampUtc(),
    };
    writeFileSync(reviewFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    agentkitInfo(`Review file updated: ${relative(root, reviewFile)}`);
    return;
  }

  if (checkOnly || transitionSpec || overrideReason) {
    if (!requirementId) {
      throw new AgentKitCliError("Requirement id is required for gate checks. Use '--id <requirement-id>'.");
    }
    if (!transitionSpec) {
      throw new AgentKitCliError("Gate checks require '--transition <from:to>'.");
    }
    const transition = parseTransitionSpec(transitionSpec);
    const gate = evaluateRequirementGate(root, requirementId, transition.from, transition.to);
    const reportRel = writeGateReport(root, gate.requirementDir, gate);
    const gateTimestamp = agentkitTimestampUtc();

    if (!gate.passed && !overrideReason) {
      updateRequirementGateMetadata(join(root, "requirements", "INDEX.md"), requirementId, {
        state: transition.from,
        lastGateCheck: gateTimestamp,
        lastGateResult: "FAIL",
      });
      agentkitWarn(`Gate report: ${reportRel}`);
      for (const check of gate.checks.filter((item) => !item.passed)) {
        agentkitWarn(`[${check.id}] ${check.message}`);
      }
      throw new AgentKitCliError("Gate check failed. Fix the failed checks or use --override-with-reason.");
    }

    const targetState = checkOnly ? transition.from : transition.to;
    updateRequirementGateMetadata(join(root, "requirements", "INDEX.md"), requirementId, {
      state: targetState,
      lastGateCheck: gateTimestamp,
      lastGateResult: gate.passed ? "PASS" : "FAIL",
    });
    if (!gate.passed && overrideReason) {
      agentkitWarn(`Gate check failed but override applied: ${overrideReason}`);
    } else {
      agentkitInfo(`Gate check passed: ${transition.from} -> ${transition.to}`);
    }
    agentkitInfo(`Gate report: ${reportRel}`);
    if (checkOnly) {
      agentkitInfo("Check-only mode enabled; only gate metadata/report were updated.");
    }
    return;
  }

  if (dispatchSubagents) {
    if (!requirementId) {
      throw new AgentKitCliError("Requirement id is required for sub-agent dispatch. Use '--id <requirement-id>'.");
    }
    const reqLookup = findRequirementDir(root, requirementId);
    const dispatchResult = writeSubAgentDispatchArtifacts(root, requirementId, reqLookup.dir);
    agentkitInfo(`Dispatch plan: ${relative(root, dispatchResult.markdown_path)}`);
    agentkitInfo(`Dispatch script: ${relative(root, dispatchResult.script_path)}`);
    for (const warning of dispatchResult.warnings) {
      agentkitWarn(warning);
    }
    return;
  }

  if (taskId) {
    const candidates = findTaskCandidatesByTaskId(root, taskId, codeRepoMode ? currentRepoKey : "");
    if (candidates.length === 0) {
      if (codeRepoMode && currentRepoKey) {
        throw new AgentKitCliError(`Task '${taskId}' was not found for repo '${currentRepoKey}'.`);
      }
      throw new AgentKitCliError(`Task '${taskId}' was not found in in-progress requirements.`);
    }
    if (candidates.length === 1) {
      agentkitInfo("Resolved task candidate:");
      for (const line of renderRepoTaskCandidate(candidates[0], root)) {
        agentkitInfo(line);
      }
      agentkitInfo("Confirm with the user before implementation.");
      return;
    }
    printRepoTaskCandidates(`Found ${candidates.length} task candidates for '${taskId}':`, candidates, root);
    agentkitInfo("Multiple requirements matched the same task id. Confirm the requirement with the user.");
    return;
  }

  if (codeRepoMode && requirementId && !task && !prdLink) {
    if (!currentRepoKey) {
      throw new AgentKitCliError(
        "Current repository does not map to any repo key. Run `agentkit bind --repo-key <repo-key>` in this repository first.",
      );
    }
    const candidates = listRequirementRepoTaskCandidates(root, requirementId, currentRepoKey);
    if (candidates.length === 0) {
      throw new AgentKitCliError(`Requirement '${requirementId}' has no task for repo '${currentRepoKey}'.`);
    }
    if (candidates.length === 1) {
      agentkitInfo("Resolved repo task candidate:");
      for (const line of renderRepoTaskCandidate(candidates[0], root)) {
        agentkitInfo(line);
      }
      agentkitInfo("Confirm with the user before implementation.");
      return;
    }
    printRepoTaskCandidates(
      `Requirement '${requirementId}' has ${candidates.length} tasks for repo '${currentRepoKey}':`,
      candidates,
      root,
    );
    agentkitInfo("Ask the user which task to implement, then rerun with --task-id.");
    return;
  }

  if (requirementId && !task && !prdLink) {
    handleRequirementSessionRouting(root, requirementId);
    if (interactiveEnabled) {
      const reviewUpdated = await maybeHandleInteractiveReview(root, requirementId);
      if (reviewUpdated) {
        handleRequirementSessionRouting(root, requirementId);
      }
      await maybeWriteInteractiveDesignDraft(root, requirementId);
      handleRequirementSessionRouting(root, requirementId);
    }
    return;
  }

  const reqTitle = task || requirementId;
  const reqId = requirementId || requirementIdFromTask(reqTitle);
  const reqDirRel = join("requirements", "in-progress", reqId);
  const reqDir = join(root, reqDirRel);
  mkdirSync(reqDir, { recursive: true });

  const tsUtc = agentkitTimestampUtc();
  const repoLinksFile = join(root, "requirements", "repo-links.yml");
  const currentLinks = readRepoLinks(repoLinksFile);
  const resolvedLinks = withRepoOverrides(currentLinks, frontendRepo, backendRepo);
  writeRepoLinks(repoLinksFile, resolvedLinks);

  const contextIndexFile = resolve(root, contextIndexPath || join("context", "index.json"));
  const query: ContextQuery = {
    stage: contextStage || undefined,
    domain: (contextDomain || domain) || undefined,
    tags: contextTags,
    limit: contextLimit,
    budgetLevel: contextBudgetLevel,
    maxTokens: contextMaxTokens || CONTEXT_BUDGET_TOKENS[contextBudgetLevel],
  };
  const contextIndex = loadContextIndex(contextIndexFile);
  const selectedContext = selectContextEntries(contextIndex.entries, query);
  updateContextEntryHitCount(contextIndexFile, selectedContext.selected);
  if (!existsSync(contextIndexFile)) {
    agentkitWarn(`Context index not found at ${contextIndexFile}. Run 'node scripts/build-index.mjs'.`);
  }

  const prdFetchStatus = prdLink ? (prdSource ? "success" : "failed") : "not-provided";
  const prdDocumentToken = prdSource ? prdSource.documentToken : "N/A";
  const prdSourceLink = prdSource ? prdSource.sourceLink : prdLink || "TODO";
  const prdActualExtractMode = prdSource ? prdSource.extractMode : prdExtractMode;
  const prdRichAvailable = prdSource ? (prdSource.richAvailable ? "yes" : "no") : "N/A";
  const prdContentRaw = prdSource
    ? prdSource.content
    : prdFetchError
      ? `PRD fetch failed: ${prdFetchError}\n\nPlease copy the PRD content manually.`
      : "TODO";
  const compactPrd = compactText(prdContentRaw, 120000);
  const prdContentForIntake = compactPrd.text;
  const prdTruncatedNote = compactPrd.truncated
    ? "\n\n[Note] PRD content was truncated to 120000 characters."
    : "";
  const derivedSections = deriveIntakeSummaryAndAcceptance(reqTitle, prdContentForIntake);
  const boardSummarySection = renderBoardSummaryTemplate(prdContentForIntake);
  const sidecarFiles: Array<{ name: string; content: string }> = [];
  if (prdSource && prdSource.extractMode === "both") {
    sidecarFiles.push({
      name: "00-intake.raw.md",
      content: `# PRD Raw Snapshot: ${reqTitle}

## Source

- PRD Link (Feishu): ${prdSource.sourceLink}
- PRD Document Token: ${prdSource.documentToken}

## Content

${prdSource.rawContent || "(raw content is empty)"}
`,
    });
    sidecarFiles.push({
      name: "00-intake.feishu.json",
      content: `${JSON.stringify(prdSource.sourcePayload, null, 2)}\n`,
    });
  }

  const testCasesMindmap = deriveTestMindmap(reqTitle, prdContentForIntake);
  const parsedTestCasesMindmap = parseMermaidMindmap(testCasesMindmap);
  const testCasesOutline = renderMindmapFeishuOutline(parsedTestCasesMindmap, false);

  const files: Array<{ name: string; content: string }> = [
    {
      name: "00-intake.md",
      content: `# Requirement Intake: ${reqTitle}

## Metadata

- Requirement ID: ${reqId}
- Owner: ${owner}
- Domain: ${domain}
- Updated At: ${tsUtc}

## Source

- PRD Link (Feishu): ${prdSourceLink}
- PRD Fetch Status: ${prdFetchStatus}
- PRD Document Token: ${prdDocumentToken}
- PRD Extract Mode: ${prdActualExtractMode}
- PRD Rich Available: ${prdRichAvailable}
- Ticket Link: TODO

## PRD Snapshot (Auto-Fetched)

${prdContentForIntake}${prdTruncatedNote}

${boardSummarySection}

## Requirement Summary

${derivedSections.summaryBullets}

## Acceptance Criteria

${derivedSections.acceptanceBullets}
`,
    },
    {
      name: "01-test-cases.mmd",
      content: testCasesMindmap,
    },
    {
      name: "01-test-cases.feishu-outline.txt",
      content: testCasesOutline,
    },
  ];

  const outputFiles = [...files, ...sidecarFiles];
  for (const item of outputFiles) {
    writeFileWithForce(root, join(reqDir, item.name), "requirement file", item.content, force);
  }
  // Clean up legacy export file if this requirement packet was regenerated from an older version.
  rmSync(join(reqDir, "01-test-cases.feishu-bullet.txt"), { force: true });
  agentkitInfo("Test case exports: 01-test-cases.feishu-outline.txt");

  updateRequirementsIndex(join(root, "requirements", "INDEX.md"), reqId, reqTitle, owner, domain, "in-progress", {
    state: "draft",
  });
  agentkitInfo(`Requirement packet ready: ${reqDirRel}`);
  agentkitInfo(
    `Context references: ${selectedContext.selected.length} (matched=${selectedContext.matched_total}, budget=${query.maxTokens}t)`,
  );
  agentkitInfo(
    `Repo links: ${Object.entries(resolvedLinks)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`,
  );
  if (prdLink) {
    if (prdSource) {
      agentkitInfo(
        `PRD fetched from Feishu: ${prdSource.title} (mode=${prdSource.extractMode}, rich=${prdSource.richAvailable ? "yes" : "no"})`,
      );
      if (sidecarFiles.length > 0) {
        agentkitInfo(`PRD sidecars: ${sidecarFiles.map((item) => item.name).join(", ")}`);
      }
    } else {
      agentkitWarn("PRD was not fetched; intake file contains a manual-fill placeholder.");
    }
  }

  if (interactiveEnabled) {
    handleRequirementSessionRouting(root, reqId);
    const reviewUpdated = await maybeHandleInteractiveReview(root, reqId);
    if (reviewUpdated) {
      handleRequirementSessionRouting(root, reqId);
    }
    await maybeWriteInteractiveDesignDraft(root, reqId);
    handleRequirementSessionRouting(root, reqId);
  }
}

function handleOptimizeFlow(args: string[]): void {
  let requirementId = "";
  let requirementTitle = "";
  let type = "context";
  let insight = "";
  let trigger = "";
  let action = "";
  let domain = "general";
  let tags: string[] = [];
  let source = "";
  let owner = process.env.USER || "unknown";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      requirementId = smartSlug(getValue(args, i, "--id"), "req");
      i += 1;
      continue;
    }
    if (arg === "--task") {
      requirementTitle = getValue(args, i, "--task");
      i += 1;
      continue;
    }
    if (arg === "--type") {
      type = getValue(args, i, "--type").toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--insight") {
      insight = getValue(args, i, "--insight");
      i += 1;
      continue;
    }
    if (arg === "--trigger") {
      trigger = getValue(args, i, "--trigger");
      i += 1;
      continue;
    }
    if (arg === "--action") {
      action = getValue(args, i, "--action");
      i += 1;
      continue;
    }
    if (arg === "--domain") {
      domain = getValue(args, i, "--domain");
      i += 1;
      continue;
    }
    if (arg === "--tags") {
      tags = parseCsv(getValue(args, i, "--tags"));
      i += 1;
      continue;
    }
    if (arg === "--source") {
      source = getValue(args, i, "--source");
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      owner = getValue(args, i, "--owner");
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit optimize-flow --id <requirement-id> --insight <text> [--type <context|risk|service|pattern>] [--trigger <text>] [--action <text>] [--domain <domain>] [--tags <a,b>] [--source <path>] [--owner <name>]

Options:
  --id        Requirement id.
  --task      Requirement title (optional, used in experience record).
  --type      Rule type: context | risk | service | pattern (default: context).
  --insight   Reusable lesson/rule content.
  --trigger   Trigger condition.
  --action    Expected action for future tasks.
  --domain    Domain (default: general).
  --tags      Comma-separated tags.
  --source    Source file link/path.
  --owner     Rule owner (default: $USER or unknown).
  -h, --help  Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for optimize-flow: ${arg}`);
  }

  if (!requirementId) {
    throw new AgentKitCliError("Requirement id is required. Use '--id <requirement-id>'.");
  }
  if (!insight) {
    throw new AgentKitCliError("Insight is required. Use '--insight <text>'.");
  }

  const typeToFile: Record<string, string> = {
    context: "context-rules.md",
    risk: "risk-rules.md",
    service: "service-rules.md",
    pattern: "pattern-rules.md",
  };
  const ruleFileName = typeToFile[type];
  if (!ruleFileName) {
    throw new AgentKitCliError("Invalid --type. Use context, risk, service, or pattern.");
  }

  const root = agentkitRepoRoot();
  ensureSpeckitLiteStructure(root);
  const tsId = agentkitTimestampId();
  const tsUtc = agentkitTimestampUtc();
  const normalizedTags = normalizeTagSet(tags);
  const tagsText = normalizedTags.length > 0 ? normalizedTags.join(", ") : "N/A";
  const sourceText = source ? relative(root, resolve(root, source)) : "N/A";
  const requirementText = requirementTitle || requirementId;
  const ruleSlug = smartSlug(`${type}-${requirementId}-${insight}`, "rule").slice(0, 60);
  const ruleId = `rule-${tsId}-${ruleSlug}`;

  const rulesDir = join(root, "context", "rules");
  mkdirSync(rulesDir, { recursive: true });
  const ruleFile = join(rulesDir, ruleFileName);
  if (!existsSync(ruleFile)) {
    const headerTitle = ruleFileName.replace(/\.md$/, "").replace(/-/g, " ");
    writeFileSync(ruleFile, `# ${headerTitle}\n`, "utf8");
  }

  const normalizedTrigger = trigger || "N/A";
  const normalizedAction = action || "N/A";
  const dedupKey = buildRuleDedupKey(type, domain, normalizedTrigger, normalizedAction, insight);
  const existingRules = parseRuleBlocks(readFileSync(ruleFile, "utf8"));
  const exactDuplicate = existingRules.find(
    (item) => item.dedupKey.length > 0 && item.dedupKey === dedupKey,
  );
  const conflictIds = existingRules
    .filter((item) => normalizeRuleValue(item.trigger) === normalizeRuleValue(normalizedTrigger))
    .filter((item) => normalizeRuleValue(item.action) !== normalizeRuleValue(normalizedAction))
    .map((item) => item.id);
  const conflicted = normalizeRuleValue(normalizedTrigger) !== "n/a" && conflictIds.length > 0;
  const score = calculateRuleScore({
    hasSource: sourceText !== "N/A",
    hasTrigger: normalizeRuleValue(normalizedTrigger) !== "n/a",
    hasAction: normalizeRuleValue(normalizedAction) !== "n/a",
    conflicted,
  });
  const confidence = calculateRuleConfidence({
    hasSource: sourceText !== "N/A",
    hasTrigger: normalizeRuleValue(normalizedTrigger) !== "n/a",
    hasAction: normalizeRuleValue(normalizedAction) !== "n/a",
    conflicted,
  });
  const ruleStatus = conflicted ? "draft-conflicted" : "draft";
  const conflictText = conflicted ? conflictIds.join(", ") : "N/A";
  let ruleAppended = false;

  if (exactDuplicate) {
    agentkitInfo(`Skipped duplicate rule (${exactDuplicate.id}) in ${relative(root, ruleFile)}.`);
  } else {
    appendFileSync(
      ruleFile,
      `
## ${ruleId}

- Requirement ID: ${requirementId}
- Requirement: ${requirementText}
- Type: ${type}
- Domain: ${domain}
- Owner: ${owner}
- Trigger: ${normalizedTrigger}
- Action: ${normalizedAction}
- Tags: ${tagsText}
- Source: ${sourceText}
- Dedup Key: ${dedupKey}
- Rule Status: ${ruleStatus}
- Score: ${score}
- Confidence: ${confidence}
- Conflict With: ${conflictText}
- Updated At: ${tsUtc}

### Rule

${insight}
`,
      "utf8",
    );
    ruleAppended = true;
  }

  const experienceDir = join(root, "context", "records", "experience");
  mkdirSync(experienceDir, { recursive: true });
  const experienceSlug = smartSlug(requirementText, "experience");
  const experienceFile = join(experienceDir, `${tsId}-${experienceSlug}.md`);
  const tagsLiteral = normalizedTags.length > 0 ? `[${normalizedTags.map((tag) => `"${tag}"`).join(", ")}]` : "[]";
  writeFileSync(
    experienceFile,
    `---
id: exp-${tsId}-${experienceSlug}
title: Experience - ${requirementText}
stage: experience
domain: ${domain}
tags: ${tagsLiteral}
owner: ${owner}
status: draft
flow_id: ${requirementId}
source: ${sourceText}
updated_at: ${tsUtc}
---

## Insight

${insight}

## Trigger

${trigger || "N/A"}

## Action

${action || "N/A"}
`,
    "utf8",
  );

  maybeRebuildContextIndex(root);
  if (ruleAppended) {
    agentkitInfo(`Updated rules: ${relative(root, ruleFile)}`);
    if (conflicted) {
      agentkitWarn(`Rule conflict detected with: ${conflictText}`);
    }
  } else {
    agentkitInfo(`Rules unchanged (duplicate): ${relative(root, ruleFile)}`);
  }
  agentkitInfo(`Captured experience: ${relative(root, experienceFile)}`);
}

function handleReview(args: string[]): void {
  let topic = "General Review";
  let testCmd = "";
  let skipHooks = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--topic") {
      topic = getValue(args, i, "--topic");
      i += 1;
      continue;
    }
    if (arg === "--test-cmd") {
      testCmd = getValue(args, i, "--test-cmd");
      i += 1;
      continue;
    }
    if (arg === "--skip-hooks") {
      skipHooks = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit review [--topic <text>] [--test-cmd <command>] [--skip-hooks]

Options:
  --topic        Review topic title (default: "General Review").
  --test-cmd     Optional test gate command to execute in repo root.
  --skip-hooks   Do not run local hook scripts.
  -h, --help     Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for review: ${arg}`);
  }

  const root = agentkitRepoRoot();
  agentkitRequireInitialized(root);

  const tsId = agentkitTimestampId();
  const tsUtc = agentkitTimestampUtc();
  const slug = agentkitSlugify(topic);
  const reviewRel = join("docs", "reviews", `${tsId}-${slug}.md`);
  const reviewFile = join(root, reviewRel);

  mkdirSync(join(root, "docs", "reviews"), { recursive: true });

  const gitStatus = runCommand("git", ["-C", root, "status", "-sb"], { allowFailure: true });
  const gitStatusText = gitStatus.status === 0 ? gitStatus.stdout.trimEnd() : "git status unavailable";

  let testResult = "not-run";
  let testOutput = "";
  if (testCmd) {
    agentkitInfo(`Running test gate command: ${testCmd}`);
    const testRun = runCommand("bash", ["-lc", testCmd], { cwd: root, allowFailure: true });
    testOutput = `${testRun.stdout}${testRun.stderr}`.trimEnd();
    testResult = testRun.status === 0 ? "passed" : "failed";
  }

  const testSection =
    testCmd.length > 0
      ? `## Test Command

\`${testCmd}\`

\`\`\`text
${testOutput}
\`\`\`

`
      : "";

  writeFileSync(
    reviewFile,
    `# Review: ${topic}

## Metadata

- Created At: ${tsUtc}
- Test Gate: ${testResult}

## Working Tree Snapshot

\`\`\`text
${gitStatusText}
\`\`\`

${testSection}## Review Checklist

- [ ] Scope matches plan
- [ ] API/schema compatibility checked
- [ ] Error handling and rollback path verified
- [ ] Tests and observability signals reviewed
- [ ] Documentation updated
`,
    "utf8",
  );

  if (!skipHooks) {
    agentkitTryHook(join(root, "workflow", "hooks", "review.sh"), [reviewFile, topic]);
  }

  agentkitInfo(`Created: ${reviewRel}`);

  if (testResult === "failed") {
    throw new AgentKitCliError(`Test gate failed. See ${reviewRel}.`);
  }
}

function handleCaptureExperience(args: string[]): void {
  let task = "";
  let insight = "";
  let owner = process.env.USER || "unknown";
  let domain = "general";
  let tags: string[] = [];
  let sourcePath = "";
  let flowId = "";
  let status = "draft";
  let target = "experience";
  let contextDir = "context";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--task") {
      task = getValue(args, i, "--task");
      i += 1;
      continue;
    }
    if (arg === "--insight") {
      insight = getValue(args, i, "--insight");
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      owner = getValue(args, i, "--owner");
      i += 1;
      continue;
    }
    if (arg === "--domain") {
      domain = getValue(args, i, "--domain");
      i += 1;
      continue;
    }
    if (arg === "--tags") {
      tags = parseCsv(getValue(args, i, "--tags"));
      i += 1;
      continue;
    }
    if (arg === "--source") {
      sourcePath = getValue(args, i, "--source");
      i += 1;
      continue;
    }
    if (arg === "--flow-id") {
      flowId = agentkitSlugify(getValue(args, i, "--flow-id"));
      i += 1;
      continue;
    }
    if (arg === "--status") {
      status = getValue(args, i, "--status");
      i += 1;
      continue;
    }
    if (arg === "--target") {
      target = getValue(args, i, "--target");
      i += 1;
      continue;
    }
    if (arg === "--context-dir") {
      contextDir = getValue(args, i, "--context-dir");
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit capture-experience --task <text> --insight <text> [--source <path>] [--flow-id <id>] [--owner <name>] [--domain <domain>] [--tags <a,b>] [--status <status>] [--target <experience|pattern|playbook>] [--context-dir <path>]

Options:
  --task         Source task title.
  --insight      Key learning to preserve.
  --source       Related source document path (for example docs/reviews/xxx.md).
  --flow-id      Flow id to link.
  --owner        Experience owner (default: $USER or unknown).
  --domain       Domain (default: general).
  --tags         Comma-separated tags.
  --status       draft | verified | deprecated (default: draft).
  --target       experience | pattern | playbook (default: experience).
  --context-dir  Context assets directory (default: context).
  -h, --help     Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for capture-experience: ${arg}`);
  }

  if (!task) {
    throw new AgentKitCliError("Task is required. Use '--task <text>'.");
  }
  if (!insight) {
    throw new AgentKitCliError("Insight is required. Use '--insight <text>'.");
  }

  const root = agentkitRepoRoot();
  const contextRoot = resolve(root, contextDir);
  let relativeTargetDir = join("records", "experience");
  if (target === "pattern") {
    relativeTargetDir = "patterns";
  } else if (target === "playbook") {
    relativeTargetDir = "playbooks";
  } else if (target !== "experience") {
    throw new AgentKitCliError("Invalid --target. Use experience, pattern, or playbook.");
  }

  const outputDir = join(contextRoot, relativeTargetDir);
  mkdirSync(outputDir, { recursive: true });

  const tsId = agentkitTimestampId();
  const tsUtc = agentkitTimestampUtc();
  const slug = agentkitSlugify(task);
  const fileName = `${tsId}-${slug}.md`;
  const filePath = join(outputDir, fileName);
  const normalizedTags = normalizeTagSet(tags);
  const tagsLiteral = normalizedTags.length > 0 ? `[${normalizedTags.map((tag) => `"${tag}"`).join(", ")}]` : "[]";
  const sourceLiteral = sourcePath ? relative(root, resolve(root, sourcePath)) : "N/A";
  const flowLiteral = flowId || "N/A";
  const idPrefix = target === "experience" ? "exp" : target === "pattern" ? "pat" : "play";
  const itemId = `${idPrefix}-${tsId}-${slug}`;

  const titlePrefix =
    target === "experience" ? "Experience" : target === "pattern" ? "Pattern" : "Playbook";
  const stage = target === "experience" ? "experience" : target;

  writeFileSync(
    filePath,
    `---
id: ${itemId}
title: ${titlePrefix}: ${task}
stage: ${stage}
domain: ${domain}
tags: ${tagsLiteral}
owner: ${owner}
status: ${status}
flow_id: ${flowLiteral}
source: ${sourceLiteral}
created_at: ${tsUtc}
updated_at: ${tsUtc}
---

## Insight

${insight}

## Reuse Guidance

- TODO

## Follow-up

- TODO
`,
    "utf8",
  );

  agentkitInfo(`Captured: ${relative(root, filePath)}`);
  maybeRebuildContextIndex(root);
}

function handleMindmapExport(args: string[]): void {
  let inputPath = "";
  let outputPath = "";
  let format: MindmapExportFormat = "feishu";
  let force = false;
  let stdout = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--input") {
      inputPath = getValue(args, i, "--input");
      i += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = getValue(args, i, "--output");
      i += 1;
      continue;
    }
    if (arg === "--format") {
      format = parseMindmapExportFormat(getValue(args, i, "--format"));
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--stdout") {
      stdout = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit mindmap-export --input <path-to-mmd> [--format <feishu|feishu-bullet|both>] [--output <path>] [--force] [--stdout]
  agentkit mindmap-export <path-to-mmd> [--format <feishu|feishu-bullet|both>]

Options:
  --input       Input .mmd file path.
  --format      Output format: feishu | feishu-bullet | both (default: feishu).
  --output      Output file path (only valid when --format is feishu / feishu-bullet).
  --force       Overwrite existing output file(s).
  --stdout      Print result to stdout instead of writing files.
  -h, --help    Show this help message.

Examples:
  agentkit mindmap-export requirements/in-progress/req-20260226-xxx/01-test-cases.mmd
  agentkit mindmap-export --input requirements/in-progress/req-20260226-xxx/01-test-cases.mmd --format feishu
  agentkit mindmap-export --input requirements/in-progress/req-20260226-xxx/01-test-cases.mmd --format feishu-bullet
  agentkit mindmap-export --input requirements/in-progress/req-20260226-xxx/01-test-cases.mmd --format both`);
      return;
    }
    if (arg.startsWith("-")) {
      throw new AgentKitCliError(`Unknown option for mindmap-export: ${arg}`);
    }
    positional.push(arg);
  }

  if (!inputPath && positional.length > 0) {
    inputPath = positional[0];
  }
  if (positional.length > 1) {
    throw new AgentKitCliError(`Unexpected argument: ${positional[1]}`);
  }
  if (!inputPath) {
    throw new AgentKitCliError("Input file is required. Use '--input <path-to-mmd>' or positional path.");
  }

  const root = agentkitRepoRoot();
  const inputFile = resolve(root, inputPath);
  if (!existsSync(inputFile)) {
    throw new AgentKitCliError(`Input file not found: ${inputFile}`);
  }
  const inputStats = statSync(inputFile);
  if (!inputStats.isFile()) {
    throw new AgentKitCliError(`Input path is not a file: ${inputFile}`);
  }
  if (format === "both" && outputPath) {
    throw new AgentKitCliError("--output cannot be used with --format both. Use default output paths.");
  }

  const content = readFileSync(inputFile, "utf8");
  const nodes = parseMermaidMindmap(content);

  const outputs: Array<{ path: string; label: string; content: string }> = [];
  if (format === "both") {
    outputs.push({
      path: defaultMindmapOutputPath(inputFile, "feishu"),
      label: "feishu outline",
      content: renderMindmapFeishuOutline(nodes, false),
    });
    outputs.push({
      path: defaultMindmapOutputPath(inputFile, "feishu-bullet"),
      label: "feishu-bullet outline",
      content: renderMindmapFeishuOutline(nodes, true),
    });
  } else {
    const target = outputPath
      ? resolve(root, outputPath)
      : defaultMindmapOutputPath(inputFile, format);
    const outputContent =
      format === "feishu-bullet" ? renderMindmapFeishuOutline(nodes, true) : renderMindmapFeishuOutline(nodes, false);
    outputs.push({
      path: target,
      label: `${format} outline`,
      content: outputContent,
    });
  }

  if (stdout) {
    if (outputs.length === 1) {
      process.stdout.write(outputs[0].content);
      return;
    }
    for (let i = 0; i < outputs.length; i += 1) {
      const output = outputs[i];
      process.stdout.write(`# ${output.label}\n`);
      process.stdout.write(output.content);
      if (i < outputs.length - 1 && !output.content.endsWith("\n\n")) {
        process.stdout.write("\n");
      }
    }
    return;
  }

  for (const output of outputs) {
    if (existsSync(output.path) && !force) {
      throw new AgentKitCliError(`Output file exists: ${output.path}. Use --force to overwrite.`);
    }
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, output.content, "utf8");
    agentkitInfo(`Wrote ${output.label}: ${relative(root, output.path)}`);
  }

  agentkitInfo(
    "Feishu usage tip: paste *.feishu-*.txt lines into Feishu mindmap nodes (tab indentation preserves hierarchy).",
  );
}

type InstallTarget = "claude" | "cursor" | "codex" | "kiro" | "trae" | "windsurf" | "opencode" | "all";
type InstallTool = Exclude<InstallTarget, "all">;
type InstallScope = "project" | "global";
const ALL_INSTALL_TOOLS: InstallTool[] = ["claude", "cursor", "codex", "kiro", "trae", "windsurf", "opencode"];
const GLOBAL_PRIMARY_COMMANDS = new Set(["req-dev", "optimize-flow", "load-service"]);

function walkMdFiles(dir: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) {
    return result;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkMdFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml"))) {
      result.push(full);
    }
  }
  return result;
}

function extractCommandDescription(content: string, fallback: string): string {
  const titleLine = content.match(/^#\s+(.+)$/m);
  if (!titleLine) {
    return fallback;
  }
  const afterDash = titleLine[1].match(/[—–]\s*(.+)/);
  return afterDash ? afterDash[1].trim() : titleLine[1].trim();
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function installFile(
  root: string,
  sourcePath: string,
  destPath: string,
  force: boolean,
  transform?: (content: string) => string,
): boolean {
  const relDest = relative(root, destPath);
  if (existsSync(destPath) && !force) {
    agentkitWarn(`Skip existing: ${relDest} (use --force to overwrite)`);
    return false;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  let content = readFileSync(sourcePath, "utf8");
  if (transform) {
    content = transform(content);
  }
  writeFileSync(destPath, content, "utf8");
  agentkitInfo(`Installed: ${relDest}`);
  return true;
}

function installGeneratedFile(root: string, destPath: string, content: string, force: boolean): boolean {
  const relDest = relative(root, destPath);
  if (existsSync(destPath) && !force) {
    agentkitWarn(`Skip existing: ${relDest} (use --force to overwrite)`);
    return false;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, content, "utf8");
  agentkitInfo(`Installed: ${relDest}`);
  return true;
}

function isInstallTool(value: string): value is InstallTool {
  return ALL_INSTALL_TOOLS.includes(value as InstallTool);
}

function installToolRoot(root: string, tool: InstallTool, scope: InstallScope): string {
  if (scope === "global") {
    return join(homedir(), `.${tool}`);
  }
  if (tool === "codex") {
    return join(root, ".agents");
  }
  return join(root, `.${tool}`);
}

function commandTargetDir(root: string, tool: InstallTool, scope: InstallScope): string | null {
  const toolRoot = installToolRoot(root, tool, scope);
  if (scope === "global" && tool === "codex") {
    return null;
  }
  if (tool === "codex") {
    return join(toolRoot, "commands");
  }
  if (tool === "windsurf") {
    return join(toolRoot, "workflows");
  }
  if (tool === "opencode") {
    return join(toolRoot, "commands");
  }
  if (tool === "kiro" || tool === "trae") {
    return null;
  }
  return join(toolRoot, "commands");
}

function skillTargetDir(root: string, tool: InstallTool, scope: InstallScope): string {
  const toolRoot = installToolRoot(root, tool, scope);
  return join(toolRoot, "skills");
}

function commandContentForTool(tool: InstallTool, rawContent: string, bodyWithoutTitle: string, description: string): string {
  if (tool === "claude" || tool === "cursor" || tool === "opencode") {
    return `---\ndescription: ${yamlQuote(description)}\n---\n\n${bodyWithoutTitle}`;
  }
  return rawContent;
}

function renderCommandSkill(
  tool: InstallTool,
  commandName: string,
  description: string,
  commandDocPath: string,
  scope: InstallScope,
): string {
  const toolLabel = tool === "codex" ? "Codex" : tool === "kiro" ? "Kiro" : "Trae";
  const purpose =
    scope === "global"
      ? `Global command entry for ${toolLabel}. Execute the canonical workflow document via the configured context root.`
      : `Project-level command entry for ${toolLabel}. Execute the canonical workflow document at \`commands/${commandName}.md\`.`;
  const steps =
    scope === "global"
      ? [
          "1. Read `~/.agentkit/config.json` and get `context_root`.",
          `2. Open \`<context_root>/commands/${commandName}.md\`. If config is missing or context_root is empty, tell the user to run \`npm run init\` in their local \`agent-project-kit\` repository first.`,
          "3. Treat user-provided command text as `$ARGUMENTS` and execute the workflow end-to-end.",
          "4. When deterministic actions are required, run the corresponding `agentkit` CLI commands.",
          "5. Return generated files, blockers, and the next action.",
        ]
      : [
          `1. Open \`${commandDocPath}\`.`,
          "2. Treat user-provided command text as `$ARGUMENTS` and execute the workflow end-to-end.",
          "3. When deterministic actions are required, run the corresponding `agentkit` CLI commands.",
          "4. Return generated files, blockers, and the next action.",
        ];
  return `---
name: ${yamlQuote(commandName)}
description: ${yamlQuote(description)}
---

# ${commandName}

## Purpose
${purpose}

## Trigger
Use this skill when the user asks to run the \`${commandName}\` workflow (including \`/${commandName}\` style mentions) or provides arguments for this command.

## Steps
${steps.join("\n")}
`;
}

function renderCodexCommandSkillInterface(commandName: string, description: string): string {
  return `interface:
  display_name: ${yamlQuote(commandName)}
  short_description: ${yamlQuote(description)}
  default_prompt: ${yamlQuote(`Run /${commandName} with the provided input.`)}
policy:
  allow_implicit_invocation: false
`;
}

function parseBootstrapTargets(input: string): InstallTool[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "skip") {
    return [];
  }
  if (normalized === "all") {
    return [...ALL_INSTALL_TOOLS];
  }
  const values = parseCsv(normalized);
  if (values.length === 0) {
    return [];
  }
  const invalid = values.filter((value) => !isInstallTool(value));
  if (invalid.length > 0) {
    throw new AgentKitCliError(
      `Invalid project targets: ${invalid.join(", ")}. Use all, none, or comma-separated tools from ${ALL_INSTALL_TOOLS.join(", ")}.`,
    );
  }
  return dedupeAndSort(values) as InstallTool[];
}

async function resolveBootstrapTargets(rawValue: string): Promise<InstallTool[]> {
  if (rawValue.trim()) {
    return parseBootstrapTargets(rawValue);
  }
  if (!canUseInteractivePrompt()) {
    agentkitInfo("Non-interactive bootstrap: installing default global and project targets for codex only. Use --targets all or a comma-separated list to customize.");
    return ["codex"];
  }

  agentkitInfo("Required setup will always install the global agentkit launcher and write ~/.agentkit/config.json.");
  const mode = await runPrompt(() =>
    promptSelect({
      message: "Select agent targets to install globally and in this repo",
      choices: [
        { name: "Install Codex only", value: "codex" },
        { name: "Install all supported tools", value: "all" },
        { name: "Choose specific tools", value: "specific" },
        { name: "Skip", value: "none" },
      ],
      default: "codex",
    }),
  );

  if (mode === "none") {
    return [];
  }
  if (mode === "codex") {
    return ["codex"];
  }
  if (mode === "all") {
    return [...ALL_INSTALL_TOOLS];
  }

  const selected = await runPrompt(() =>
    promptCheckbox({
      message: "Select agent targets",
      choices: ALL_INSTALL_TOOLS.map((tool) => ({
        name: tool,
        value: tool,
        checked: tool === "codex",
      })),
    }),
  );
  return dedupeAndSort(selected) as InstallTool[];
}

function resolveBootstrapTargetsInput(
  targetsInput: string,
  legacyGlobalTargetsInput: string,
  legacyProjectTargetsInput: string,
): string {
  if (targetsInput.trim()) {
    return targetsInput;
  }
  const legacyValues = [legacyGlobalTargetsInput, legacyProjectTargetsInput].map((value) => value.trim()).filter(Boolean);
  if (legacyValues.length === 0) {
    return "";
  }
  if (legacyValues.length === 1) {
    return legacyValues[0];
  }

  const mergedTargets = dedupeAndSort(legacyValues.flatMap((value) => parseBootstrapTargets(value)));
  agentkitWarn(`Bootstrap now uses a single target set for global and project installs. Using merged targets: ${mergedTargets.join(", ") || "none"}.`);
  return mergedTargets.length === 0 ? "none" : mergedTargets.join(",");
}

async function handleBootstrap(args: string[]): Promise<void> {
  let force = false;
  let targetsInput = "";
  let legacyGlobalTargetsInput = "";
  let legacyProjectTargetsInput = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--targets") {
      targetsInput = getValue(args, i, "--targets");
      i += 1;
      continue;
    }
    if (arg === "--global-targets") {
      legacyGlobalTargetsInput = getValue(args, i, "--global-targets");
      i += 1;
      continue;
    }
    if (arg === "--project-targets") {
      legacyProjectTargetsInput = getValue(args, i, "--project-targets");
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit bootstrap [--targets <all|none|claude,cursor,...>] [--force]

Bootstrap the local agent-project-kit clone for day-to-day usage.

Always performs:
  - install-global
  - bind --global-only

Options:
  --targets          Agent targets to install both globally and in the current repo. Global installs include only req-dev / optimize-flow / load-service. If omitted in a TTY, bootstrap asks interactively.
  --global-targets   Legacy alias. Merged with --project-targets when provided.
  --project-targets  Legacy alias. Merged with --global-targets when provided.
  --force            Overwrite existing generated files and launcher.
  -h, --help         Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for bootstrap: ${arg}`);
  }

  const root = agentkitRepoRoot();
  if (!looksLikeContextRepoRoot(root)) {
    throw new AgentKitCliError("Bootstrap must be run inside the agent-project-kit repository.");
  }

  const bootstrapTargetsInput = resolveBootstrapTargetsInput(targetsInput, legacyGlobalTargetsInput, legacyProjectTargetsInput);
  const bootstrapTargets = await resolveBootstrapTargets(bootstrapTargetsInput);
  const forceArgs = force ? ["--force"] : [];

  handleInstallGlobal(forceArgs);
  handleBind(["--global-only"]);

  if (bootstrapTargets.length === 0) {
    agentkitInfo("Skipped bootstrap agent target installation.");
    return;
  }

  if (bootstrapTargets.length === ALL_INSTALL_TOOLS.length) {
    handleInstall(["--scope", "global", "--target", "all", ...forceArgs]);
    handleInstall(["--target", "all", ...forceArgs]);
    agentkitInfo(`Installed bootstrap targets for global and project scopes: ${bootstrapTargets.join(", ")}`);
  } else {
    for (const target of bootstrapTargets) {
      handleInstall(["--scope", "global", "--target", target, ...forceArgs]);
      handleInstall(["--target", target, ...forceArgs]);
    }
    agentkitInfo(`Installed bootstrap targets for global and project scopes: ${bootstrapTargets.join(", ")}`);
  }
}

function handleInstall(args: string[]): void {
  let target: InstallTarget = "all";
  let scope: InstallScope = "project";
  let force = false;
  let contextRootOverride = "";
  let repoKeyInput = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      const value = getValue(args, i, "--target");
      if (value !== "all" && !isInstallTool(value)) {
        throw new AgentKitCliError("--target must be claude, cursor, codex, kiro, trae, windsurf, opencode, or all.");
      }
      target = value as InstallTarget;
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      const value = getValue(args, i, "--scope").trim().toLowerCase();
      if (value !== "project" && value !== "global") {
        throw new AgentKitCliError("--scope must be project or global.");
      }
      scope = value as InstallScope;
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--context-root") {
      contextRootOverride = getValue(args, i, "--context-root").trim();
      i += 1;
      continue;
    }
    if (arg === "--repo-key") {
      repoKeyInput = getValue(args, i, "--repo-key").trim();
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit install [--target claude|cursor|codex|kiro|trae|windsurf|opencode|all] [--scope project|global] [--context-root <path>] [--repo-key <repo-key>] [--force]

Install canonical commands and skills into tool-specific directories.
Command projection:
  - Claude/Cursor/OpenCode: .*/commands/*.md
  - Windsurf: .windsurf/workflows/*.md
  - Codex/Kiro/Trae: generated command-skills in each tool's skills directory
  - Global scope installs only req-dev / optimize-flow / load-service into user-level tool directories.

Options:
  --target  Install target: claude, cursor, codex, kiro, trae, windsurf, opencode, or all (default: all).
  --scope   Install scope: project or global (default: project).
  --context-root  Source agent-project-kit repository root when running inside a code repository.
  --repo-key      Repo key in requirements/repo-links.yml; used to register local workspace override.
  --force   Overwrite existing files.
  -h, --help Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for install: ${arg}`);
  }

  const targetRoot = agentkitRepoRoot();
  let sourceRoot = targetRoot;
  let sourceResolvedFrom = "repo-root";
  if (!looksLikeContextRepoRoot(targetRoot)) {
    if (contextRootOverride) {
      sourceRoot = resolveContextRootPath(targetRoot, contextRootOverride);
      sourceResolvedFrom = "option";
    } else {
      const bound = resolveBoundContextRoot(targetRoot);
      if (!bound) {
        throw new AgentKitCliError(
          "Install requires a agent-project-kit source. Run inside the context repo, or pass --context-root <path>, or bind this repo first.",
        );
      }
      sourceRoot = bound.path;
      sourceResolvedFrom = bound.source;
    }
    agentkitInfo(`Using context root: ${sourceRoot} (source=${sourceResolvedFrom})`);
  }
  const commandsDir = join(sourceRoot, "commands");
  const skillsDir = join(sourceRoot, "skills");

  const toolNames: InstallTool[] = [];
  if (target === "all") {
    toolNames.push(...ALL_INSTALL_TOOLS);
  } else {
    toolNames.push(target as InstallTool);
  }

  let installedCount = 0;

  // --- Install commands ---
  if (existsSync(commandsDir)) {
    const cmdFiles: string[] = [];
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        (scope !== "global" || GLOBAL_PRIMARY_COMMANDS.has(entry.name.replace(/\.md$/, "")))
      ) {
        cmdFiles.push(entry.name);
      }
    }

    for (const file of cmdFiles) {
      const sourcePath = join(commandsDir, file);
      const rawContent = readFileSync(sourcePath, "utf8");
      const description = extractCommandDescription(rawContent, file.replace(/\.md$/, ""));
      const bodyWithoutTitle = rawContent.replace(/^#\s+.+\n+/, "");

      for (const tool of toolNames) {
        const commandDir = commandTargetDir(targetRoot, tool, scope);
        if (commandDir) {
          const destPath = join(commandDir, file);
          const content = commandContentForTool(tool, rawContent, bodyWithoutTitle, description);
          if (installFile(scope === "project" ? targetRoot : installToolRoot(targetRoot, tool, scope), sourcePath, destPath, force, () => content)) {
            installedCount += 1;
          }
        }

        if (tool === "codex" || tool === "kiro" || tool === "trae") {
          const commandName = file.replace(/\.md$/, "");
          const commandSkillDir = join(skillTargetDir(targetRoot, tool, scope), commandName);
          const skillPath = join(commandSkillDir, "SKILL.md");
          const installLogRoot = scope === "project" ? targetRoot : installToolRoot(targetRoot, tool, scope);

          if (
            installGeneratedFile(
              installLogRoot,
              skillPath,
              renderCommandSkill(tool, commandName, description, sourcePath, scope),
              force,
            )
          ) {
            installedCount += 1;
          }

          if (tool === "codex") {
            const skillInterfacePath = join(commandSkillDir, "agents", "openai.yaml");
            if (
              installGeneratedFile(
                installLogRoot,
                skillInterfacePath,
                renderCodexCommandSkillInterface(commandName, description),
                force,
              )
            ) {
              installedCount += 1;
            }
          }
        }
      }
    }
  } else {
    agentkitWarn("commands/ directory not found. Skipping commands.");
  }

  // --- Install skills ---
  if (scope === "global") {
    agentkitInfo("Global scope skips non-command skills.");
  } else if (existsSync(skillsDir)) {
    const skillFiles = walkMdFiles(skillsDir);

    for (const sourcePath of skillFiles) {
      const relFromSkills = relative(skillsDir, sourcePath);

      for (const tool of toolNames) {
        const installLogRoot = scope === "project" ? targetRoot : installToolRoot(targetRoot, tool, scope);
        const destPath = join(skillTargetDir(targetRoot, tool, scope), relFromSkills);
        if (installFile(installLogRoot, sourcePath, destPath, force)) {
          installedCount += 1;
        }
      }
    }
  } else {
    agentkitWarn("skills/ directory not found. Skipping skills.");
  }

  if (sourceRoot !== targetRoot) {
    const localBind = readLocalBindConfig(targetRoot);
    let resolvedRepoKey = repoKeyInput || localBind.repo_key || readProjectRepoKey(targetRoot) || "";
    if (!resolvedRepoKey) {
      resolvedRepoKey = inferRepoKeyForWorkspace(targetRoot, sourceRoot);
    }

    agentkitEnsureGitignoreLine(targetRoot, ".agentkit/bind.local.json");
    const bindFile = writeLocalBindConfig(targetRoot, {
      context_root: sourceRoot,
      repo_key: resolvedRepoKey || undefined,
      active_requirement_id: localBind.active_requirement_id,
    });
    agentkitInfo(`Updated local bind file: ${relative(targetRoot, bindFile)}`);

    const globalBind = readGlobalBindConfig();
    let wroteGlobalBind = false;
    const nextGlobalBind: GlobalBindConfig = {
      ...globalBind,
      context_root: globalBind.context_root || sourceRoot,
      workspace_overrides: { ...(globalBind.workspace_overrides || {}) },
    };
    if (!globalBind.context_root) {
      wroteGlobalBind = true;
    } else if (globalBind.context_root !== sourceRoot) {
      agentkitWarn(
        `Global context root remains ${globalBind.context_root}; local bind for this repo will use ${sourceRoot}.`,
      );
    }
    if (resolvedRepoKey) {
      nextGlobalBind.workspace_overrides = {
        ...(nextGlobalBind.workspace_overrides || {}),
        [resolvedRepoKey]: targetRoot,
      };
      wroteGlobalBind = true;
    }
    if (wroteGlobalBind) {
      const globalFile = writeGlobalBindConfig(nextGlobalBind);
      agentkitInfo(`Updated global bind file: ${globalFile}`);
      if (resolvedRepoKey) {
        agentkitInfo(`Registered workspace override: ${resolvedRepoKey} -> ${targetRoot}`);
      }
    } else if (!resolvedRepoKey) {
      agentkitWarn("Repo key could not be inferred. Run 'agentkit bind --repo-key <repo-key>' in this repo to register its workspace override.");
    }
  }

  agentkitInfo(`Done. ${installedCount} file(s) installed for ${toolNames.join(", ")}.`);
}

function handleInstallGlobal(args: string[]): void {
  let targetDir = join(homedir(), ".local", "bin");
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target-dir") {
      targetDir = expandUserPath(getValue(args, i, "--target-dir"));
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit install-global [--target-dir <path>] [--force]

Options:
  --target-dir   Install destination directory (default: $HOME/.local/bin).
  --force        Replace existing launcher if present.
  -h, --help     Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for install-global: ${arg}`);
  }

  const root = agentkitRepoRoot();
  const sourceCmd = join(root, "cli", "dist", "cli.js");
  const launcher = join(targetDir, "agentkit");
  const nodeBinary = process.argv[0] || "node";

  if (!existsSync(sourceCmd)) {
    throw new AgentKitCliError(`Missing built CLI: ${sourceCmd}. Run 'npm run build' first.`);
  }
  mkdirSync(targetDir, { recursive: true });

  if (existsSync(launcher)) {
    if (!force) {
      throw new AgentKitCliError(`Launcher already exists at ${launcher}. Use --force to replace.`);
    }
    rmSync(launcher, { force: true });
  }

  writeFileSync(
    launcher,
    `#!/usr/bin/env bash
set -euo pipefail
# agentkit global launcher (generated by agentkit install-global)
exec ${shellEscape(nodeBinary)} ${shellEscape(sourceCmd)} "$@"
`,
    "utf8",
  );
  chmodSync(launcher, 0o755);

  const pathParts = (process.env.PATH || "").split(":");
  const inPath = pathParts.includes(targetDir);

  agentkitInfo(`Installed global launcher: ${launcher}`);
  if (!inPath) {
    agentkitWarn(`Directory is not in PATH: ${targetDir}`);
    agentkitInfo("Add it to your shell profile:");
    agentkitInfo(`export PATH="${targetDir}:$PATH"`);
  }
  agentkitInfo("You can now run: agentkit help");
}

function handleUninstallGlobal(args: string[]): void {
  let targetDir = join(homedir(), ".local", "bin");
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target-dir") {
      targetDir = expandUserPath(getValue(args, i, "--target-dir"));
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage:
  agentkit uninstall-global [--target-dir <path>] [--force]

Options:
  --target-dir   Launcher directory (default: $HOME/.local/bin).
  --force        Remove existing file even if it was not created by agentkit.
  -h, --help     Show this help message.`);
      return;
    }
    throw new AgentKitCliError(`Unknown option for uninstall-global: ${arg}`);
  }

  const launcher = join(targetDir, "agentkit");
  if (!existsSync(launcher)) {
    agentkitInfo(`No launcher found at ${launcher}`);
    return;
  }

  if (!force) {
    const content = readFileSync(launcher, "utf8");
    if (!content.includes("generated by agentkit install-global")) {
      throw new AgentKitCliError(`Refusing to remove non-agentkit launcher at ${launcher}. Use --force to override.`);
    }
  }

  rmSync(launcher, { force: true });
  agentkitInfo(`Removed global launcher: ${launcher}`);
}

async function main(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? "help";
  const args = argv.slice(1);

  if (subcommand === "help" || subcommand === "-h" || subcommand === "--help" || subcommand === "") {
    agentkitUsage();
    return 0;
  }
  if (subcommand === "init") {
    handleInit(args);
    return 0;
  }
  if (subcommand === "flow-init") {
    handleFlowInit(args);
    return 0;
  }
  if (subcommand === "flow-next") {
    handleFlowNext(args);
    return 0;
  }
  if (subcommand === "sync-context") {
    handleSyncContext(args);
    return 0;
  }
  if (subcommand === "bind") {
    handleBind(args);
    return 0;
  }
  if (subcommand === "req-dev") {
    await handleReqDev(args);
    return 0;
  }
  if (subcommand === "optimize-flow") {
    handleOptimizeFlow(args);
    return 0;
  }
  if (subcommand === "load-service") {
    handleLoadService(args);
    return 0;
  }
  if (subcommand === "mindmap-export") {
    handleMindmapExport(args);
    return 0;
  }
  if (subcommand === "review") {
    handleReview(args);
    return 0;
  }
  if (subcommand === "capture-experience") {
    handleCaptureExperience(args);
    return 0;
  }
  if (subcommand === "bootstrap") {
    await handleBootstrap(args);
    return 0;
  }
  if (subcommand === "install") {
    handleInstall(args);
    return 0;
  }
  if (subcommand === "install-global") {
    handleInstallGlobal(args);
    return 0;
  }
  if (subcommand === "uninstall-global") {
    handleUninstallGlobal(args);
    return 0;
  }

  throw new AgentKitCliError(`Unknown command: ${subcommand}. Run 'agentkit help'.`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof AgentKitCliError) {
      agentkitError(error.message);
      process.exitCode = 1;
    } else if (error instanceof Error) {
      agentkitError(error.message);
      process.exitCode = 1;
    } else {
      agentkitError(String(error));
      process.exitCode = 1;
    }
  });
