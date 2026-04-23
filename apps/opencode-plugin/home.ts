import path from "node:path";
import { createDashboardSession, waitForDashboardSessionDecision, type SessionSource } from "@plannotator/shared/dashboard";
import { openBrowser } from "@plannotator/server/browser";
import { startHomeServer, type HomeServerResult } from "@plannotator/server/home";
import { getHomePort, isRemoteSession } from "@plannotator/server/remote";
import { registerSession } from "@plannotator/server/sessions";

let homeServerPromise: Promise<HomeServerResult> | null = null;
type HomeHelperDeps = {
  createDashboardSession: typeof createDashboardSession;
  waitForDashboardSessionDecision: typeof waitForDashboardSessionDecision;
  openBrowser: typeof openBrowser;
  startHomeServer: typeof startHomeServer;
  getHomePort: typeof getHomePort;
  isRemoteSession: typeof isRemoteSession;
  registerSession: typeof registerSession;
  fetchImpl: typeof fetch;
};

const defaultDeps: HomeHelperDeps = {
  createDashboardSession,
  waitForDashboardSessionDecision,
  openBrowser,
  startHomeServer,
  getHomePort,
  isRemoteSession,
  registerSession,
  fetchImpl: fetch,
};

let homeHelperDeps: HomeHelperDeps = { ...defaultDeps };

function getHomeUrl(): string {
  return `http://localhost:${homeHelperDeps.getHomePort()}`;
}

function getProjectLabel(directory: string): string {
  const base = path.basename(path.resolve(directory));
  return base || "_unknown";
}

async function isHomeReady(url: string): Promise<boolean> {
  try {
    const response = await homeHelperDeps.fetchImpl(`${url}/api/plan`);
    return response.ok;
  } catch {
    return false;
  }
}

export function setHomeHelperDepsForTest(overrides: Partial<HomeHelperDeps>): void {
  homeHelperDeps = {
    ...defaultDeps,
    ...overrides,
  };
  homeServerPromise = null;
}

export function resetHomeHelperStateForTest(): void {
  homeHelperDeps = { ...defaultDeps };
  homeServerPromise = null;
}

export async function ensureHomeServerRunning(options: {
  directory: string;
  htmlContent: string;
}): Promise<string> {
  const knownUrl = getHomeUrl();
  if (await isHomeReady(knownUrl)) {
    return knownUrl;
  }

  if (!homeServerPromise) {
    homeServerPromise = homeHelperDeps.startHomeServer({
      htmlContent: options.htmlContent,
    }).then((server) => {
      const project = getProjectLabel(options.directory);
      homeHelperDeps.registerSession({
        pid: process.pid,
        port: server.port,
        url: server.url,
        mode: "home",
        project,
        startedAt: new Date().toISOString(),
        label: `home-${project}`,
      });
      return server;
    }).catch((error) => {
      homeServerPromise = null;
      throw error;
    });
  }

  const server = await homeServerPromise;
  return server.url;
}

export async function publishPlanToHome(options: {
  plan: string;
  directory: string;
  origin: SessionSource;
  permissionMode?: string;
  htmlContent: string;
}): Promise<{ sessionId: string; url: string }> {
  const baseUrl = await ensureHomeServerRunning({
    directory: options.directory,
    htmlContent: options.htmlContent,
  });
  const session = homeHelperDeps.createDashboardSession({
    plan: options.plan,
    project: getProjectLabel(options.directory),
    origin: options.origin,
    permissionMode: options.permissionMode,
  });
  const url = `${baseUrl}/?session=${encodeURIComponent(session.id)}`;
  await homeHelperDeps.openBrowser(url, { isRemote: homeHelperDeps.isRemoteSession() });
  return { sessionId: session.id, url };
}

export async function waitForPublishedPlanDecision(sessionId: string): Promise<{
  approved: boolean;
  feedback?: string;
  permissionMode?: string;
  agentSwitch?: string;
}> {
  return homeHelperDeps.waitForDashboardSessionDecision(sessionId);
}
