import { describe, expect, test } from "bun:test";
import {
  buildCodexPlanReviewCommand,
  buildPlanReviewPrompt,
  formatPlanForReview,
  normalizePlanReviewComments,
} from "./plan-review";

describe("formatPlanForReview", () => {
  test("numbers markdown lines for line-anchored review", () => {
    const output = formatPlanForReview("# Title\n\n- one\n- two");
    expect(output).toContain("1 | # Title");
    expect(output).toContain("3 | - one");
    expect(output).toContain("4 | - two");
  });
});

describe("buildPlanReviewPrompt", () => {
  test("includes preset guidance and custom prompt", () => {
    const prompt = buildPlanReviewPrompt({
      plan: "# Title\n\nBody",
      reviewer: {
        provider: "codex",
        model: "gpt-5.4",
        promptPreset: "strict",
        customPrompt: "Focus on rollback and ownership.",
      },
    });

    expect(prompt).toContain("Focus on rollback and ownership.");
    expect(prompt).toContain("missing owners");
    expect(prompt).toContain("1 | # Title");
  });
});

describe("normalizePlanReviewComments", () => {
  test("converts review findings into persisted dashboard comments", () => {
    const comments = normalizePlanReviewComments([
      {
        title: "Missing owner",
        body: "Assign a specific owner for the rollout.",
        lineStart: 12,
        lineEnd: 13,
        severity: "important",
      },
    ]);

    expect(comments).toHaveLength(1);
    expect(comments[0].filePath).toBe("PLAN.md");
    expect(comments[0].lineStart).toBe(12);
    expect(comments[0].title).toBe("Missing owner");
  });
});

describe("buildCodexPlanReviewCommand", () => {
  test("skips the git repo check when the review worker runs in a temp directory", () => {
    const command = buildCodexPlanReviewCommand({
      schemaPath: "/tmp/schema.json",
      outputPath: "/tmp/out.json",
      prompt: "review this plan",
      model: "gpt-5.4",
    });

    expect(command).toContain("--skip-git-repo-check");
    expect(command.slice(0, 4)).toEqual(["codex", "-m", "gpt-5.4", "exec"]);
  });
});
