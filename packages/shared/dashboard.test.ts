import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDashboardSession,
  getDashboardSettings,
  listDashboardSessions,
  saveDashboardSettings,
  saveDashboardSessionDecision,
  updateDashboardSession,
  waitForDashboardSessionDecision,
} from "./dashboard";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-dashboard-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("dashboard session storage", () => {
  test("creates a pending plan session with derived title", () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Launch Plan\n\nShip it.",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    expect(session.project).toBe("demo-project");
    expect(session.origin).toBe("claude-code");
    expect(session.status).toBe("pending");
    expect(session.title).toBe("Launch Plan");

    const listed = listDashboardSessions(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(session.id);
  });

  test("orders most recently updated sessions first", async () => {
    const dir = makeTempDir();
    const first = createDashboardSession({
      plan: "# First\n\nOne",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });
    const second = createDashboardSession({
      plan: "# Second\n\nTwo",
      project: "demo-project",
      origin: "opencode",
      baseDir: dir,
    });

    updateDashboardSession(second.id, { status: "approved" }, dir);
    updateDashboardSession(first.id, { status: "denied" }, dir);

    const listed = listDashboardSessions(dir);
    expect(listed[0].id).toBe(first.id);
    expect(listed[1].id).toBe(second.id);
  });
});

describe("dashboard settings storage", () => {
  test("persists reviewer defaults", () => {
    const dir = makeTempDir();

    saveDashboardSettings(
      {
        reviewer: {
          provider: "ollama",
          model: "qwen2.5-coder:14b",
          promptPreset: "strict",
          customPrompt: "Focus on plan clarity.",
        },
      },
      dir,
    );

    expect(getDashboardSettings(dir)).toEqual({
      reviewer: {
        provider: "ollama",
        model: "qwen2.5-coder:14b",
        promptPreset: "strict",
        customPrompt: "Focus on plan clarity.",
      },
    });
  });
});

describe("dashboard session decisions", () => {
  test("waits for an approval decision written by another process", async () => {
    const dir = makeTempDir();
    const session = createDashboardSession({
      plan: "# Approval\n\nPlease approve",
      project: "demo-project",
      origin: "claude-code",
      baseDir: dir,
    });

    setTimeout(() => {
      saveDashboardSessionDecision(
        session.id,
        {
          approved: true,
          permissionMode: "acceptEdits",
        },
        dir,
      );
    }, 25);

    await expect(
      waitForDashboardSessionDecision(session.id, { baseDir: dir, timeoutMs: 500, pollMs: 10 }),
    ).resolves.toEqual({
      approved: true,
      permissionMode: "acceptEdits",
    });
  });
});
