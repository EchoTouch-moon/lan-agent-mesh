# lan-agent-mesh ZCode plugin (ZPL-1, #99)

Wraps the seven existing `mesh_*` MCP tools of this repository (`packages/mcp-server`) as a ZCode plugin. The plugin is a **packaging layer only** — it adds no protocol, no network listener and no new authority: every call still goes through the local stdio MCP server, the Gateway's scoped credential, and ZCode's native permission prompts.

## What it registers

- MCP server `lam-mesh` (stdio) → `packages/mcp-server/dist/cli.js` via `bridge/mesh-bridge.mjs`, digest-pinned by `digests.json` (fail-closed on mismatch).
- Commands `/mesh-agents` (read-only), `/mesh-status` (read-only), `/mesh-watch <taskId>` (read-only), `/mesh-delegate <agentId> <workspaceAlias> <text>` (asks the user first; host native permission governs).
- Skill `mesh-tool-semantics`: requestId idempotency, UNKNOWN no-new-id, cancel terminal-state, denial finality. The skill text is guidance, **not authorization**.
- No hooks, no agents, no approve/auto-allow anywhere.

## Install (local directory, operator-managed)

Verified startup path on the installed ZCode CLI 0.17.0 / Desktop 3.16.3 (Windows):

1. Build the LAM checkout this plugin pins: `pnpm install --frozen-lockfile && pnpm build` (produces `packages/mcp-server/dist/cli.js`).
2. On the machine running ZCode, mint a scoped credential with the Gateway operator CLI (never printed, never committed):
   `node apps/gateway/dist/index.js control --data <gateway-data-dir> --command mcp-grant --args-file <scope.json> --output <private-dir>\credential.json`
   where `scope.json` is `{"peers":["<remote peer mesh id>"],"agents":["<agentId>"],"workspaces":["<alias>"]}`. Store the output inside a private (G2) directory — not in this repo, not in the plugin folder.
3. In ZCode: Settings → Plugins → 个人 → Create → 添加插件市场 → local directory → select `integrations/zcode-plugin` (this folder, containing `marketplace.json`), then install **lan-agent-mesh** from the `lam-local` market. Or via CLI: `zcode plugins marketplace add <this folder>` then `zcode plugins install lan-agent-mesh@lam-local`.
4. Set the three environment variables the plugin resolves (per-user, no admin needed), then **restart ZCode**:
   - `ZCODE_LAM_NODE` — absolute path to `node.exe` / `node` (the Node the LAM checkout was verified with);
   - `ZCODE_LAM_ROOT` — absolute path to this LAM checkout;
   - `ZCODE_LAM_CREDENTIAL_FILE` — absolute path to the credential file from step 2.

   Example (Windows, per-user, from one terminal; takes effect for newly started ZCode):
   `setx ZCODE_LAM_NODE "C:\path\to\node.exe"` (repeat for the other two).
   `ZCODE_PLUGIN_ROOT` is supplied by the ZCode host itself — do not set it by hand.
5. Verify: `zcode plugins list` must show `mcp: plugin:lan-agent-mesh:lam-mesh`, and `/mesh-agents` appears via `zcode commands list`.

**Configuration negative (verified)**: with any of the three variables unset, the plugin installs and enables, commands still register, but the MCP server does **not** — `plugins list` shows `mcp: none` for this plugin and no `mesh_*` tools exist. That is the intended fail-closed behavior; fix the missing variable and restart instead of working around it.

Uninstall removes the plugin only; the credential file, the Gateway data directory, the environment variables and every user setting stay untouched.

## Security properties

- No token in the package; the credential path comes from the `ZCODE_LAM_CREDENTIAL_FILE` environment variable (set by the operator, visible in the environment, never written into the manifest or the repo), and the file itself is opened by the MCP server under private-storage verification.
- The plugin never reads Gateway `control.json` or any admin surface; the credential is a scoped MCP grant.
- `bridge/mesh-bridge.mjs` refuses to start when `packages/mcp-server/dist/cli.js` is absent or its SHA-256 differs from `digests.json` (`mcpCliSha256`, bound to `testedSourceSha`).
- Side-effecting tools (`mesh_start_session`, `mesh_send_message`, `mesh_delegate_task`, `mesh_cancel_task`) rely on the host's native permission and the grant scope; default is deny. The read-only trio is `mesh_list_agents` / `mesh_list_sessions` / `mesh_get_task`.

## Fallback when plugin install is unavailable

If the installed ZCode does not accept local-marketplace plugin install, use the same bridge through workspace-scoped MCP config (project `.mcp.json`), which native ZCode outbound has already been verified with on Windows (#93). Point it at the identical `mesh-bridge.mjs` / `digests.json` pair so the digest gate still applies. Do not modify global/user MCP config for this.

## Verification status

See `docs/local/evidence/zcode-plugin/windows-20261027/` in the repository for what was actually exercised on the installed ZCode CLI 0.17.0 / Desktop 3.16.3 (plugin surface probes, validate, isolated install, tool advertisement). Capability claims stay at the level the evidence shows; nothing here upgrades them.
