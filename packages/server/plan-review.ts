import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type {
  DashboardReviewCapability,
  DashboardReviewComment,
  DashboardReviewerSettings,
} from "@plannotator/shared/dashboard";

export interface RawPlanReviewFinding {
  title: string;
  body: string;
  lineStart: number;
  lineEnd: number;
  severity: "important" | "nit";
}

interface PlanReviewOutput {
  findings: RawPlanReviewFinding[];
}

const DEFAULT_MODELS: Record<string, string> = {
  codex: "gpt-5.4",
  claude: "claude-sonnet-4-6",
  ollama: "qwen2.5-coder:14b",
};

const PRESET_GUIDANCE: Record<string, string> = {
  balanced: "Focus on missing steps, contradictions, unclear scope, weak testing, or rollout gaps.",
  strict: "Be strict about missing owners, rollout safety, rollback plans, acceptance criteria, and vague sequencing.",
  concise: "Return only the most actionable plan issues the author would definitely want to fix.",
  custom: "Use the custom prompt as the primary review policy.",
};

const PLAN_REVIEW_SCHEMA_JSON = JSON.stringify({
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          lineStart: { type: "integer" },
          lineEnd: { type: "integer" },
          severity: { type: "string", enum: ["important", "nit"] },
        },
        required: ["title", "body", "lineStart", "lineEnd", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
});

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseStructuredOutput(text: string): PlanReviewOutput {
  const parsed = JSON.parse(stripCodeFence(text)) as Partial<PlanReviewOutput>;
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return {
    findings: findings
      .filter((finding): finding is RawPlanReviewFinding => (
        !!finding &&
        typeof finding.title === "string" &&
        typeof finding.body === "string" &&
        typeof finding.lineStart === "number" &&
        typeof finding.lineEnd === "number" &&
        (finding.severity === "important" || finding.severity === "nit")
      )),
  };
}

export function formatPlanForReview(plan: string): string {
  return plan
    .split("\n")
    .map((line, index) => `${index + 1} | ${line}`)
    .join("\n");
}

export function buildPlanReviewPrompt(options: {
  plan: string;
  reviewer: Pick<DashboardReviewerSettings, "provider" | "model" | "promptPreset" | "customPrompt">;
}): string {
  const preset = PRESET_GUIDANCE[options.reviewer.promptPreset] ?? PRESET_GUIDANCE.balanced;
  const customPrompt = options.reviewer.customPrompt?.trim();

  return [
    "You are reviewing a markdown implementation plan.",
    "Return only actionable line comments the author would want to fix before implementation starts.",
    "Prefer issues such as missing owners, vague rollout steps, missing rollback plans, weak testing, unclear sequencing, or contradictions.",
    'Respond as JSON with shape {"findings":[{"title","body","lineStart","lineEnd","severity"}]}.',
    "Use severity 'important' for blocking plan issues and 'nit' for smaller improvements.",
    "Reference the numbered source lines below. Use short ranges.",
    "",
    `Preset guidance: ${preset}`,
    ...(customPrompt ? ["", `Custom guidance: ${customPrompt}`] : []),
    "",
    "Plan source:",
    formatPlanForReview(options.plan),
  ].join("\n");
}

export function normalizePlanReviewComments(findings: RawPlanReviewFinding[]): DashboardReviewComment[] {
  const now = Date.now();
  return findings.map((finding, index) => ({
    id: crypto.randomUUID(),
    filePath: "PLAN.md",
    lineStart: Math.max(1, Math.floor(finding.lineStart)),
    lineEnd: Math.max(Math.floor(finding.lineStart), Math.floor(finding.lineEnd)),
    text: finding.body,
    title: finding.title,
    severity: finding.severity,
    createdAt: now + index,
    updatedAt: now + index,
  }));
}

async function ensureSchemaPath(): Promise<string> {
  const dir = join(homedir(), ".plannotator");
  const filePath = join(dir, "plan-review-schema.json");
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, PLAN_REVIEW_SCHEMA_JSON);
  return filePath;
}

export function buildCodexPlanReviewCommand(options: {
  schemaPath: string;
  outputPath: string;
  prompt: string;
  model?: string;
}): string[] {
  return [
    "codex",
    "-m",
    options.model || DEFAULT_MODELS.codex,
    "exec",
    "--output-schema",
    options.schemaPath,
    "-o",
    options.outputPath,
    "--full-auto",
    "--ephemeral",
    "--skip-git-repo-check",
    options.prompt,
  ];
}

async function runCodexPlanReview(prompt: string, model?: string): Promise<PlanReviewOutput> {
  const schemaPath = await ensureSchemaPath();
  const workDir = await mkdtemp(join(tmpdir(), "plannotator-plan-review-"));
  const outputPath = join(workDir, "codex-plan-review.json");
  const command = buildCodexPlanReviewCommand({
    schemaPath,
    outputPath,
    prompt,
    model,
  });

  try {
    const proc = Bun.spawn(command, {
      cwd: workDir,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `codex exited with ${exitCode}`);
    }
    return parseStructuredOutput(await readFile(outputPath, "utf-8"));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runClaudePlanReview(prompt: string, model?: string): Promise<PlanReviewOutput> {
  const command = [
    "claude",
    "-p",
    "--permission-mode",
    "dontAsk",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    PLAN_REVIEW_SCHEMA_JSON,
    "--no-session-persistence",
    "--model",
    model || DEFAULT_MODELS.claude,
    "--tools",
    "Read,Glob,Grep",
    "--allowedTools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Edit,Write,NotebookEdit,WebFetch,WebSearch,Bash(*)",
  ];

  const proc = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const sink = proc.stdin as import("bun").FileSink;
  sink.write(prompt);
  sink.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `claude exited with ${exitCode}`);
  }

  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = JSON.parse(lines[i]) as { type?: string; is_error?: boolean; structured_output?: unknown };
    if (event.type === "result" && !event.is_error && event.structured_output) {
      return parseStructuredOutput(JSON.stringify(event.structured_output));
    }
  }

  throw new Error("Claude review produced no structured output");
}

async function runOllamaPlanReview(prompt: string, model?: string): Promise<PlanReviewOutput> {
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.ollama,
      prompt,
      stream: false,
      format: "json",
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}`);
  }

  const body = await response.json() as { response?: string };
  if (!body.response) {
    throw new Error("Ollama returned no response payload");
  }
  return parseStructuredOutput(body.response);
}

export async function getPlanReviewCapabilities(): Promise<DashboardReviewCapability[]> {
  let ollamaModels: string[] = [];
  let ollamaAvailable = false;

  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (response.ok) {
      const body = await response.json() as { models?: Array<{ name?: string }> };
      ollamaModels = (body.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0);
      ollamaAvailable = true;
    }
  } catch {
    ollamaAvailable = false;
  }

  return [
    {
      id: "codex",
      name: "Codex",
      available: !!Bun.which("codex"),
      models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2-codex"],
    },
    {
      id: "claude",
      name: "Claude",
      available: !!Bun.which("claude"),
      models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    },
    {
      id: "ollama",
      name: "Ollama",
      available: ollamaAvailable,
      models: ollamaModels,
    },
  ];
}

export async function runPlanReview(options: {
  plan: string;
  reviewer: Pick<DashboardReviewerSettings, "provider" | "model" | "promptPreset" | "customPrompt">;
}): Promise<DashboardReviewComment[]> {
  const prompt = buildPlanReviewPrompt(options);

  let output: PlanReviewOutput;
  switch (options.reviewer.provider) {
    case "codex":
      output = await runCodexPlanReview(prompt, options.reviewer.model);
      break;
    case "claude":
      output = await runClaudePlanReview(prompt, options.reviewer.model);
      break;
    case "ollama":
      output = await runOllamaPlanReview(prompt, options.reviewer.model);
      break;
    default:
      throw new Error(`Unsupported reviewer provider: ${options.reviewer.provider}`);
  }

  return normalizePlanReviewComments(output.findings);
}
