import { type SessionSource, createDashboardSession, waitForDashboardSessionDecision } from "@plannotator/shared/dashboard";
import { openBrowser } from "@plannotator/server/browser";
import { getHomePort, isRemoteSession } from "@plannotator/server/remote";
import { listSessions, type SessionInfo } from "@plannotator/server/sessions";

const HOME_START_TIMEOUT_MS = 10_000;
const HOME_POLL_MS = 200;

function getHomeUrl(): string {
  return `http://localhost:${getHomePort()}`;
}

function buildSelfSpawnCommand(args: string[]): string[] {
  const scriptPath = process.argv[1];
  const looksLikeScript = !!scriptPath && /\.(mjs|cjs|js|ts|tsx)$/.test(scriptPath);
  return looksLikeScript
    ? [process.execPath, scriptPath, ...args]
    : [process.execPath, ...args];
}

function findRunningHomeSession(): SessionInfo | null {
  return listSessions().find((session) => session.mode === "home") ?? null;
}

async function waitForHomeReady(timeoutMs: number = HOME_START_TIMEOUT_MS): Promise<string> {
  const startedAt = Date.now();
  const url = getHomeUrl();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const res = await fetch(`${url}/api/plan`);
      if (res.ok) return url;
    } catch {
      // Retry until timeout.
    }
    await Bun.sleep(HOME_POLL_MS);
  }

  throw new Error(`Timed out waiting for home server on ${url}`);
}

export async function ensureHomeServerRunning(): Promise<string> {
  const existing = findRunningHomeSession();
  if (existing) {
    return existing.url;
  }

  const command = buildSelfSpawnCommand(["home", "--daemon"]);
  const proc = Bun.spawn(command, {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  if ("unref" in proc && typeof proc.unref === "function") {
    proc.unref();
  }

  return waitForHomeReady();
}

export async function publishPlanToHome(options: {
  plan: string;
  project: string;
  origin: SessionSource;
  permissionMode?: string;
}): Promise<{ sessionId: string; url: string }> {
  const baseUrl = await ensureHomeServerRunning();
  const session = createDashboardSession({
    plan: options.plan,
    project: options.project,
    origin: options.origin,
    permissionMode: options.permissionMode,
  });
  const url = `${baseUrl}/?session=${encodeURIComponent(session.id)}`;
  await openBrowser(url, { isRemote: isRemoteSession() });
  return { sessionId: session.id, url };
}

export async function waitForPublishedPlanDecision(sessionId: string): Promise<{
  approved: boolean;
  feedback?: string;
  permissionMode?: string;
  agentSwitch?: string;
}> {
  return waitForDashboardSessionDecision(sessionId);
}
