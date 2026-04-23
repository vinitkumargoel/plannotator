#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-local.sh [--skip-build] [--no-cli] [--no-claude] [--no-opencode] [--help]

Replaces the released Plannotator install on this machine with the current
workspace checkout, then refreshes the local integration points.

Options:
  --skip-build    Reuse existing built artifacts instead of rebuilding
  --no-cli        Do not replace ~/.local/bin/plannotator
  --no-claude     Do not replace the Claude marketplace install
  --no-opencode   Do not rewrite the OpenCode plugin config
  -h, --help      Show this help and exit

Re-run this script after local code changes to rebuild and refresh the machine
install. The wrapper command will continue pointing at this repo checkout.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_DIR="${PLANNOTATOR_INSTALL_DIR:-$HOME/.local/bin}"
CLAUDE_MARKETPLACE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/plannotator"
CLAUDE_COMMANDS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/commands"
OPENCODE_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OPENCODE_CONFIG_FILE="${OPENCODE_CONFIG_DIR}/opencode.json"
OPENCODE_COMMAND_DIR="${OPENCODE_CONFIG_DIR}/command"
OPENCODE_COMMANDS_DIR="${OPENCODE_CONFIG_DIR}/commands"
OPENCODE_PLUGIN_SPEC="file:${REPO_ROOT}/apps/opencode-plugin"

skip_build=0
install_cli=1
install_claude=1
install_opencode=1

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build)
      skip_build=1
      shift
      ;;
    --no-cli)
      install_cli=0
      shift
      ;;
    --no-claude)
      install_claude=0
      shift
      ;;
    --no-opencode)
      install_opencode=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for the local Plannotator install" >&2
  exit 1
fi

run_builds() {
  echo "Building local Plannotator artifacts..."
  (
    cd "$REPO_ROOT"
    bun run build:review
    bun run build:hook
    bun run build:opencode
  )
}

install_cli_wrapper() {
  mkdir -p "$INSTALL_DIR"
  rm -f "$INSTALL_DIR/plannotator" "$INSTALL_DIR/plannotator.exe" "$INSTALL_DIR/plannotator-local-update"

  cat > "$INSTALL_DIR/plannotator" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bun "$REPO_ROOT/apps/hook/server/index.ts" "\$@"
EOF

  chmod +x "$INSTALL_DIR/plannotator"
  cat > "$INSTALL_DIR/plannotator-local-update" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$REPO_ROOT/scripts/install-local.sh" "\$@"
EOF

  chmod +x "$INSTALL_DIR/plannotator-local-update"
  echo "Installed local CLI wrapper at $INSTALL_DIR/plannotator"
  echo "Installed local updater at $INSTALL_DIR/plannotator-local-update"
}

install_claude_marketplace_link() {
  mkdir -p "$(dirname "$CLAUDE_MARKETPLACE_DIR")" "$CLAUDE_COMMANDS_DIR"
  rm -rf "$CLAUDE_MARKETPLACE_DIR"
  ln -s "$REPO_ROOT" "$CLAUDE_MARKETPLACE_DIR"
  cp "$REPO_ROOT"/apps/hook/commands/*.md "$CLAUDE_COMMANDS_DIR/"

  echo "Linked Claude marketplace plugin to $REPO_ROOT"
  echo "Updated Claude commands in $CLAUDE_COMMANDS_DIR"
}

install_opencode_config() {
  mkdir -p "$OPENCODE_CONFIG_DIR" "$OPENCODE_COMMAND_DIR" "$OPENCODE_COMMANDS_DIR"

  bun -e '
    import { existsSync, readFileSync, writeFileSync } from "node:fs";

    const configPath = process.argv[1];
    const localSpec = process.argv[2];

    const config = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf8"))
      : {};

    const pluginList = Array.isArray(config.plugin) ? config.plugin : [];
    let preservedOptions: Record<string, unknown> | undefined;
    const nextPluginList: Array<string | [string, Record<string, unknown>]> = [];

    for (const entry of pluginList) {
      const spec = Array.isArray(entry) ? entry[0] : entry;
      const options = Array.isArray(entry) ? entry[1] : undefined;
      const isLocalPlannotator = typeof spec === "string" && spec.startsWith("file:") && spec.includes("/apps/opencode-plugin");
      const isPublishedPlannotator = typeof spec === "string" && /^@plannotator\/opencode(?:@.*)?$/.test(spec);

      if (isLocalPlannotator || isPublishedPlannotator) {
        if (!preservedOptions && options && typeof options === "object" && !Array.isArray(options)) {
          preservedOptions = options as Record<string, unknown>;
        }
        continue;
      }

      nextPluginList.push(entry as string | [string, Record<string, unknown>]);
    }

    nextPluginList.push(preservedOptions ? [localSpec, preservedOptions] : localSpec);
    config.plugin = nextPluginList;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  ' "$OPENCODE_CONFIG_FILE" "$OPENCODE_PLUGIN_SPEC"

  cp "$REPO_ROOT"/apps/opencode-plugin/commands/*.md "$OPENCODE_COMMAND_DIR/"
  cp "$REPO_ROOT"/apps/opencode-plugin/commands/*.md "$OPENCODE_COMMANDS_DIR/"
  (
    cd "$REPO_ROOT"
    ./scripts/clear-opencode-cache.sh
  )

  echo "Updated OpenCode config at $OPENCODE_CONFIG_FILE"
  echo "Updated OpenCode commands in $OPENCODE_COMMAND_DIR and $OPENCODE_COMMANDS_DIR"
}

verify_install() {
  if [ "$install_cli" -eq 1 ]; then
    "$INSTALL_DIR/plannotator" --help >/dev/null
  fi

  if [ "$install_claude" -eq 1 ] && [ "$(readlink "$CLAUDE_MARKETPLACE_DIR")" != "$REPO_ROOT" ]; then
    echo "Claude marketplace link verification failed" >&2
    exit 1
  fi

  if [ "$install_opencode" -eq 1 ]; then
    bun -e '
      import { readFileSync } from "node:fs";
      const config = JSON.parse(readFileSync(process.argv[1], "utf8"));
      const pluginList = Array.isArray(config.plugin) ? config.plugin : [];
      const spec = process.argv[2];
      const found = pluginList.some((entry: unknown) => (Array.isArray(entry) ? entry[0] : entry) === spec);
      if (!found) {
        throw new Error(`Missing OpenCode plugin spec: ${spec}`);
      }
    ' "$OPENCODE_CONFIG_FILE" "$OPENCODE_PLUGIN_SPEC"
  fi
}

if [ "$skip_build" -eq 0 ]; then
  run_builds
fi

if [ "$install_cli" -eq 1 ]; then
  install_cli_wrapper
fi

if [ "$install_claude" -eq 1 ]; then
  install_claude_marketplace_link
fi

if [ "$install_opencode" -eq 1 ]; then
  install_opencode_config
fi

verify_install

echo ""
echo "Local Plannotator install is active from:"
echo "  $REPO_ROOT"
echo ""
echo "To refresh after future changes, run:"
echo "  bash $REPO_ROOT/scripts/install-local.sh"
