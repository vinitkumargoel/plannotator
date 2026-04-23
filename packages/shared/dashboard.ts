import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Origin } from "./agents";

export type SessionSource = Origin | "manual-import";
export type SessionStatus = "pending" | "approved" | "denied";
export type ReviewerProvider = "codex" | "claude" | "ollama";

export interface DashboardReviewComment {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  title?: string;
  severity?: "important" | "nit";
  createdAt: number;
  updatedAt: number;
}

export interface DashboardReviewCapability {
  id: ReviewerProvider;
  name: string;
  available: boolean;
  models: string[];
}

export interface DashboardSession {
  id: string;
  mode: "plan";
  title: string;
  plan: string;
  project: string;
  origin: SessionSource;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  updatedOrder: string;
  permissionMode?: string;
  reviewComments: DashboardReviewComment[];
  decision?: DashboardSessionDecision;
}

export interface DashboardReviewerSettings {
  provider: ReviewerProvider;
  model?: string;
  promptPreset: string;
  customPrompt?: string;
}

export interface DashboardSettings {
  reviewer: DashboardReviewerSettings;
}

export interface DashboardSessionDecision {
  approved: boolean;
  feedback?: string;
  permissionMode?: string;
  agentSwitch?: string;
}

export interface CreateDashboardSessionInput {
  plan: string;
  project: string;
  origin: SessionSource;
  permissionMode?: string;
  baseDir?: string;
}

const DEFAULT_SETTINGS: DashboardSettings = {
  reviewer: {
    provider: "codex",
    model: "gpt-5.4",
    promptPreset: "balanced",
    customPrompt: "",
  },
};

function getDashboardBaseDir(baseDir?: string): string {
  const dir = baseDir || join(homedir(), ".plannotator", "dashboard");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getSessionsDir(baseDir?: string): string {
  const dir = join(getDashboardBaseDir(baseDir), "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getSettingsPath(baseDir?: string): string {
  return join(getDashboardBaseDir(baseDir), "settings.json");
}

function getSessionPath(id: string, baseDir?: string): string {
  return join(getSessionsDir(baseDir), `${id}.json`);
}

function deriveTitle(plan: string): string {
  const heading = plan.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return "Untitled Plan";
}

function nextUpdatedOrder(): string {
  return process.hrtime.bigint().toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSession(session: DashboardSession, baseDir?: string): DashboardSession {
  writeFileSync(getSessionPath(session.id, baseDir), JSON.stringify(session, null, 2), "utf-8");
  return session;
}

export function readDashboardSession(id: string, baseDir?: string): DashboardSession | null {
  const filePath = getSessionPath(id, baseDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as DashboardSession;
  } catch {
    return null;
  }
}

export function createDashboardSession(input: CreateDashboardSessionInput): DashboardSession {
  const now = new Date().toISOString();
  const session: DashboardSession = {
    id: crypto.randomUUID(),
    mode: "plan",
    title: deriveTitle(input.plan),
    plan: input.plan,
    project: input.project,
    origin: input.origin,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    updatedOrder: nextUpdatedOrder(),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    reviewComments: [],
  };
  return writeSession(session, input.baseDir);
}

export function updateDashboardSession(
  id: string,
  patch: Partial<Omit<DashboardSession, "id" | "createdAt">>,
  baseDir?: string,
): DashboardSession {
  const existing = readDashboardSession(id, baseDir);
  if (!existing) {
    throw new Error(`Dashboard session not found: ${id}`);
  }

  return writeSession(
    {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedOrder: nextUpdatedOrder(),
    },
    baseDir,
  );
}

export function saveDashboardSessionDecision(
  id: string,
  decision: DashboardSessionDecision,
  baseDir?: string,
): DashboardSession {
  const patch: Partial<DashboardSession> = {
    status: decision.approved ? "approved" : "denied",
    decision,
  };
  if (decision.permissionMode) {
    patch.permissionMode = decision.permissionMode;
  }
  return updateDashboardSession(id, patch, baseDir);
}

export function listDashboardSessions(baseDir?: string): DashboardSession[] {
  const dir = getSessionsDir(baseDir);

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(join(dir, entry), "utf-8")) as DashboardSession;
      } catch {
        return null;
      }
    })
    .filter((session): session is DashboardSession => session !== null)
    .sort((a, b) => {
      const order = BigInt(b.updatedOrder) - BigInt(a.updatedOrder);
      if (order !== 0n) {
        return order > 0n ? 1 : -1;
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
}

export function getDashboardSettings(baseDir?: string): DashboardSettings {
  const filePath = getSettingsPath(baseDir);
  if (!existsSync(filePath)) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<DashboardSettings>;
    return {
      reviewer: {
        ...DEFAULT_SETTINGS.reviewer,
        ...(parsed.reviewer ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveDashboardSettings(settings: DashboardSettings, baseDir?: string): DashboardSettings {
  writeFileSync(getSettingsPath(baseDir), JSON.stringify(settings, null, 2), "utf-8");
  return settings;
}

export async function waitForDashboardSessionDecision(
  id: string,
  options?: { baseDir?: string; timeoutMs?: number; pollMs?: number },
): Promise<DashboardSessionDecision> {
  const timeoutMs = options?.timeoutMs ?? 1000 * 60 * 60 * 24 * 4;
  const pollMs = options?.pollMs ?? 250;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const session = readDashboardSession(id, options?.baseDir);
    if (!session) {
      throw new Error(`Dashboard session not found: ${id}`);
    }
    if (session.decision) {
      return session.decision;
    }
    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for dashboard session decision: ${id}`);
}
