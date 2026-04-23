import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(join(import.meta.dir, "install-local.sh"), "utf-8");

describe("install-local.sh", () => {
  test("installs a local wrapper into ~/.local/bin", () => {
    expect(script).toContain('INSTALL_DIR="${PLANNOTATOR_INSTALL_DIR:-$HOME/.local/bin}"');
    expect(script).toContain('exec bun "');
    expect(script).toContain('apps/hook/server/index.ts');
    expect(script).toContain('plannotator-local-update');
  });

  test("rewires the Claude marketplace install to the local repo", () => {
    expect(script).toContain('CLAUDE_MARKETPLACE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/plannotator"');
    expect(script).toContain('ln -s "$REPO_ROOT" "$CLAUDE_MARKETPLACE_DIR"');
  });

  test("rewrites OpenCode to the local file: plugin spec", () => {
    expect(script).toContain('OPENCODE_PLUGIN_SPEC="file:${REPO_ROOT}/apps/opencode-plugin"');
    expect(script).toContain('@plannotator\\/opencode');
    expect(script).toContain("config.plugin = nextPluginList;");
  });

  test("rebuilds the local artifacts before installation", () => {
    expect(script).toContain('bun run build:review');
    expect(script).toContain('bun run build:hook');
    expect(script).toContain('bun run build:opencode');
  });

  test("refreshes OpenCode commands and clears caches", () => {
    expect(script).toContain('apps/opencode-plugin/commands/*.md');
    expect(script).toContain('./scripts/clear-opencode-cache.sh');
  });
});
