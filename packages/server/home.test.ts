import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardSession } from "@plannotator/shared/dashboard";
import { startHomeServer } from "./home";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-home-server-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("home server", () => {
  test("boots into dashboard mode and can load a specific session", async () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Dashboard Plan\n\nHello",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
    });

    try {
      const dashboardRes = await fetch(`${server.url}/api/plan`);
      const dashboardData = await dashboardRes.json();

      expect(dashboardData.mode).toBe("dashboard");
      expect(dashboardData.sessions).toHaveLength(1);
      expect(dashboardData.sessions[0].id).toBe(session.id);

      const sessionRes = await fetch(`${server.url}/api/plan?session=${session.id}`);
      const sessionData = await sessionRes.json();

      expect(sessionData.mode).toBe("dashboard-session");
      expect(sessionData.plan).toContain("Dashboard Plan");
      expect(sessionData.dashboardSession.id).toBe(session.id);
    } finally {
      server.stop();
    }
  });

  test("imports a manual markdown session", async () => {
    const dir = makeTempDir();
    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
    });

    try {
      const importRes = await fetch(`${server.url}/api/home/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "# Imported\n\nManual",
          project: "manual-project",
        }),
      });
      const imported = await importRes.json();

      expect(imported.session.origin).toBe("manual-import");
      expect(imported.session.project).toBe("manual-project");

      const dashboardRes = await fetch(`${server.url}/api/plan`);
      const dashboardData = await dashboardRes.json();
      expect(dashboardData.sessions[0].id).toBe(imported.session.id);
    } finally {
      server.stop();
    }
  });

  test("writes approve and deny decisions through the existing api routes", async () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Decision Plan\n\nHello",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
    });

    try {
      const denyRes = await fetch(`${server.url}/api/deny?session=${session.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedback: "Please fix the rollout section.",
        }),
      });
      expect(denyRes.status).toBe(200);

      const deniedRes = await fetch(`${server.url}/api/plan?session=${session.id}`);
      const deniedData = await deniedRes.json();
      expect(deniedData.dashboardSession.status).toBe("denied");
      expect(deniedData.dashboardSession.decision.feedback).toContain("rollout");

      const approved = createDashboardSession({
        plan: "# Approved Plan\n\nShip",
        project: "demo-project",
        origin: "claude-code",
        baseDir: dir,
      });

      const approveRes = await fetch(`${server.url}/api/approve?session=${approved.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permissionMode: "acceptEdits",
          agentSwitch: "build",
        }),
      });
      expect(approveRes.status).toBe(200);

      const approvedRes = await fetch(`${server.url}/api/plan?session=${approved.id}`);
      const approvedData = await approvedRes.json();
      expect(approvedData.dashboardSession.status).toBe("approved");
      expect(approvedData.dashboardSession.decision.permissionMode).toBe("acceptEdits");
      expect(approvedData.dashboardSession.decision.agentSwitch).toBe("build");
    } finally {
      server.stop();
    }
  });

  test("reads and saves dashboard reviewer settings", async () => {
    const dir = makeTempDir();
    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
    });

    try {
      const saveRes = await fetch(`${server.url}/api/home/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewer: {
            provider: "ollama",
            model: "qwen2.5-coder:14b",
            promptPreset: "strict",
            customPrompt: "Look for rollout and ownership gaps.",
          },
        }),
      });
      expect(saveRes.status).toBe(200);

      const readRes = await fetch(`${server.url}/api/home/settings`);
      const settings = await readRes.json();
      expect(settings.reviewer.provider).toBe("ollama");
      expect(settings.reviewer.promptPreset).toBe("strict");
    } finally {
      server.stop();
    }
  });

  test("reports reviewer capabilities on dashboard endpoints", async () => {
    const dir = makeTempDir();
    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
    });

    try {
      const dashboardRes = await fetch(`${server.url}/api/plan`);
      const dashboardData = await dashboardRes.json();
      const capabilityIds = (dashboardData.reviewCapabilities ?? [])
        .map((provider: { id: string }) => provider.id)
        .sort();

      expect(capabilityIds).toEqual(["claude", "codex", "ollama"]);

      const capabilityRes = await fetch(`${server.url}/api/home/review-capabilities`);
      const capabilityData = await capabilityRes.json();
      const endpointIds = (capabilityData.providers ?? [])
        .map((provider: { id: string }) => provider.id)
        .sort();

      expect(endpointIds).toEqual(["claude", "codex", "ollama"]);
    } finally {
      server.stop();
    }
  });

  test("runs plan review and persists returned line comments on the session", async () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Review Plan\n\n- rollout\n- tests",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
      reviewRunner: async () => ([
        {
          id: "r1",
          filePath: "PLAN.md",
          lineStart: 3,
          lineEnd: 3,
          text: "Spell out who owns the rollout.",
          severity: "important",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    });

    try {
      const reviewRes = await fetch(`${server.url}/api/home/review?session=${session.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewer: {
            provider: "codex",
            model: "gpt-5.4",
            promptPreset: "balanced",
          },
        }),
      });
      const reviewData = await reviewRes.json();

      expect(reviewData.comments).toHaveLength(1);
      expect(reviewData.comments[0].lineStart).toBe(3);

      const sessionRes = await fetch(`${server.url}/api/plan?session=${session.id}`);
      const sessionData = await sessionRes.json();
      expect(sessionData.dashboardSession.reviewComments).toHaveLength(1);
      expect(sessionData.dashboardSession.reviewComments[0].text).toContain("rollout");
    } finally {
      server.stop();
    }
  });

  test("surfaces plan review errors instead of collapsing them into a generic bad request", async () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Review Plan\n\n- rollout\n- tests",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    const server = await startHomeServer({
      htmlContent: "<!doctype html><html><body>home</body></html>",
      baseDir: dir,
      port: 0,
      reviewRunner: async () => {
        throw new Error("Codex review failed");
      },
    });

    try {
      const reviewRes = await fetch(`${server.url}/api/home/review?session=${session.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewer: {
            provider: "codex",
            model: "gpt-5.4",
            promptPreset: "balanced",
          },
        }),
      });
      const reviewData = await reviewRes.json();

      expect(reviewRes.status).toBe(500);
      expect(reviewData.error).toContain("Codex review failed");
    } finally {
      server.stop();
    }
  });
});
