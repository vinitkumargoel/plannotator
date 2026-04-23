import {
  createDashboardSession,
  type DashboardReviewComment,
  type DashboardReviewerSettings,
  getDashboardSettings,
  listDashboardSessions,
  readDashboardSession,
  saveDashboardSettings,
  saveDashboardSessionDecision,
  updateDashboardSession,
} from "@plannotator/shared/dashboard";
import { getServerHostname, getHomePort, isRemoteSession } from "./remote";
import { getPlanReviewCapabilities, runPlanReview } from "./plan-review";

export interface HomeServerOptions {
  htmlContent: string;
  baseDir?: string;
  port?: number;
  onReady?: (url: string, isRemote: boolean, port: number) => void;
  reviewRunner?: (input: {
    sessionId: string;
    plan: string;
    reviewer: Record<string, unknown>;
  }) => Promise<DashboardReviewComment[]>;
}

export interface HomeServerResult {
  port: number;
  url: string;
  stop: () => void;
}

export async function startHomeServer(options: HomeServerOptions): Promise<HomeServerResult> {
  const port = options.port ?? getHomePort();
  const isRemote = isRemoteSession();
  const server = Bun.serve({
    hostname: getServerHostname(),
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/plan" && req.method === "GET") {
        const sessionId = url.searchParams.get("session");
        const sessions = listDashboardSessions(options.baseDir);
        const settings = getDashboardSettings(options.baseDir);
        const reviewCapabilities = await getPlanReviewCapabilities();

        if (sessionId) {
          const session = readDashboardSession(sessionId, options.baseDir);
          if (!session) {
            return Response.json({ error: "Session not found" }, { status: 404 });
          }

          return Response.json({
            mode: "dashboard-session",
            plan: session.plan,
            origin: session.origin,
            dashboardSession: session,
            sessions,
            dashboardSettings: settings,
            reviewCapabilities,
          });
        }

        return Response.json({
          mode: "dashboard",
          sessions,
          dashboardSettings: settings,
          reviewCapabilities,
        });
      }

      if (url.pathname === "/api/home/import" && req.method === "POST") {
        try {
          const body = await req.json() as { plan?: string; project?: string };
          if (!body.plan?.trim()) {
            return Response.json({ error: "Missing plan" }, { status: 400 });
          }
          const session = createDashboardSession({
            plan: body.plan,
            project: body.project?.trim() || "_unknown",
            origin: "manual-import",
            baseDir: options.baseDir,
          });
          return Response.json({ session });
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }

      if ((url.pathname === "/api/approve" || url.pathname === "/api/deny") && req.method === "POST") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
          return Response.json({ error: "Missing session" }, { status: 400 });
        }
        if (!readDashboardSession(sessionId, options.baseDir)) {
          return Response.json({ error: "Session not found" }, { status: 404 });
        }

        try {
          const body = await req.json() as { feedback?: string; permissionMode?: string; agentSwitch?: string };
          const session = saveDashboardSessionDecision(
            sessionId,
            {
              approved: url.pathname === "/api/approve",
              ...(body.feedback ? { feedback: body.feedback } : {}),
              ...(body.permissionMode ? { permissionMode: body.permissionMode } : {}),
              ...(body.agentSwitch ? { agentSwitch: body.agentSwitch } : {}),
            },
            options.baseDir,
          );
          return Response.json({ ok: true, session });
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }

      if (url.pathname === "/api/home/settings") {
        if (req.method === "GET") {
          return Response.json(getDashboardSettings(options.baseDir));
        }
        if (req.method === "POST") {
          try {
            const body = await req.json();
            const settings = saveDashboardSettings(body, options.baseDir);
            return Response.json(settings);
          } catch {
            return Response.json({ error: "Invalid JSON" }, { status: 400 });
          }
        }
      }

      if (url.pathname === "/api/home/review-capabilities" && req.method === "GET") {
        return Response.json({ providers: await getPlanReviewCapabilities() });
      }

      if (url.pathname === "/api/home/review" && req.method === "POST") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
          return Response.json({ error: "Missing session" }, { status: 400 });
        }
        const session = readDashboardSession(sessionId, options.baseDir);
        if (!session) {
          return Response.json({ error: "Session not found" }, { status: 404 });
        }

        try {
          const body = await req.json() as { reviewer?: Record<string, unknown> };
          const comments = options.reviewRunner
            ? await options.reviewRunner({
                sessionId,
                plan: session.plan,
                reviewer: body.reviewer ?? {},
              })
            : await runPlanReview({
                plan: session.plan,
                reviewer: (body.reviewer ?? getDashboardSettings(options.baseDir).reviewer) as DashboardReviewerSettings,
              });
          updateDashboardSession(sessionId, { reviewComments: comments }, options.baseDir);
          return Response.json({ comments });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Plan review failed";
          return Response.json({ error: message }, { status: 500 });
        }
      }

      return new Response(options.htmlContent, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  const actualPort = server.port!;
  const url = `http://localhost:${actualPort}`;
  options.onReady?.(url, isRemote, actualPort);

  return {
    port: actualPort,
    url,
    stop: () => server.stop(true),
  };
}
