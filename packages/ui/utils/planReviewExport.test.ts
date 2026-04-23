import { describe, expect, test } from "bun:test";
import { exportPlanReviewComments } from "./parser";
import type { CodeAnnotation } from "../types";

describe("exportPlanReviewComments", () => {
  test("formats virtual plan line comments for deny feedback", () => {
    const comments: CodeAnnotation[] = [
      {
        id: "c1",
        type: "comment",
        filePath: "PLAN.md",
        lineStart: 8,
        lineEnd: 10,
        side: "new",
        text: "The rollout needs a rollback step and owner.",
        createdAt: Date.now(),
        severity: "important",
      },
    ];

    const output = exportPlanReviewComments(comments);

    expect(output).toContain("# AI Plan Review");
    expect(output).toContain("PLAN.md (lines 8-10)");
    expect(output).toContain("Important");
    expect(output).toContain("rollback step");
  });
});
