<h1 align="center">Copilot-Mem</h1>

<h4 align="center">Persistent memory for <a href="https://github.com/features/copilot" target="_blank">GitHub Copilot</a> agent sessions in VS Code.</h4>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/version-13.5.5-green.svg" alt="Version">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node">
  </a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#mcp-search-tools">Search Tools</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#troubleshooting">Troubleshooting</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  Copilot agent mode starts every session from scratch. Copilot-Mem changes that: it automatically captures tool-usage observations during your agent sessions, compresses them into semantic summaries, and injects the relevant context back into future sessions — so Copilot remembers your project even after the session ends.
</p>

---

## Quick Start

Install as an agent plugin in VS Code:

1. Open the Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run **Chat: Install Plugin From Source**
3. Enter the repository URL:

```
https://github.com/ramikhafagi96/copilot-mem
```

VS Code clones the repository, detects the plugin, and loads its lifecycle hooks, skills, and MCP search server.

Alternatively, install through the GitHub Copilot CLI (plugins under `~/.copilot/installed-plugins/` are discovered by VS Code automatically):

```bash
copilot plugin install ramikhafagi96/copilot-mem
```

Or add the repository as a plugin marketplace in your VS Code settings and install **copilot-mem** from the Extensions sidebar (filter with `@agentPlugins`):

```json
{
  "chat.pluginMarketplaces": ["ramikhafagi96/copilot-mem"]
}
```

Start a new Copilot agent session — from the second session onward, relevant context from previous sessions appears automatically.

See the [VS Code Copilot setup guide](docs/public/vscode-copilot/setup.mdx) for prerequisites, verification steps, and troubleshooting.

**Key Features:**

- 🧠 **Persistent Memory** - Context survives across Copilot agent sessions
- 📊 **Progressive Disclosure** - Layered memory retrieval with token cost visibility
- 🔍 **Skill-Based Search** - Query your project history with the mem-search skill
- 🖥️ **Web Viewer UI** - Real-time memory stream at http://localhost:37777
- 🔒 **Privacy Control** - Use `<private>` tags to exclude sensitive content from storage
- ⚙️ **Context Configuration** - Fine-grained control over what context gets injected
- 🤖 **Automatic Operation** - No manual intervention required
- 🔗 **Citations** - Reference past observations with IDs (access via http://localhost:37777/api/observation/{id} or view all in the web viewer)

---

## How It Works

**Core Components:**

1. **Lifecycle Hooks** - SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop — run by VS Code's agent plugin system on every Copilot agent session
2. **Smart Install** - Cached dependency checker (pre-hook script, not a lifecycle hook)
3. **Worker Service** - HTTP API on port 37777 with web viewer UI and search endpoints, managed by Bun
4. **SQLite Database** - Stores sessions, observations, summaries
5. **mem-search Skill** - Natural language queries with progressive disclosure
6. **Chroma Vector Database** - Hybrid semantic + keyword search for intelligent context retrieval

Copilot-Mem normalizes Copilot's tool names (`read_file`, `replace_string_in_file`, `run_in_terminal`, …) into a canonical observation format, compresses observations into semantic summaries in the background, and injects the most relevant memory at the start of each new session. Per-file history timelines are injected ahead of large file reads, and session summaries are generated when a session stops.

---

## MCP Search Tools

Copilot-Mem provides intelligent memory search through MCP tools following a token-efficient **3-layer workflow pattern**:

1. **`search`** - Get a compact index with IDs (~50-100 tokens/result) — full-text queries, filters by type/date/project
2. **`timeline`** - Get chronological context around interesting results
3. **`get_observations`** - Fetch full details ONLY for filtered IDs (~500-1,000 tokens/result; always batch multiple IDs)

Start with `search` to get an index, use `timeline` to see what was happening around specific observations, then fetch full details only for the IDs that matter — roughly **10x token savings** compared to fetching everything up front.

The bundled MCP server registers these tools in Copilot agent mode automatically — just ask Copilot about past work ("what did we decide about the auth flow last week?") and it will search your memory.

---

## System Requirements

- **VS Code** with GitHub Copilot Chat and agent mode (agent plugins enabled — `chat.pluginsEnabled`, on by default in recent VS Code)
- **Node.js**: 20.0.0 or higher
- **Bun**: JavaScript runtime and process manager (auto-installed if missing)
- **uv**: Python package manager for vector search (auto-installed if missing)
- **SQLite 3**: For persistent storage (bundled)

### Windows Setup Notes

If you see an error like:

```powershell
npm : The term 'npm' is not recognized as the name of a cmdlet
```

Make sure Node.js and npm are installed and added to your PATH. Download the latest Node.js installer from https://nodejs.org and restart your terminal after installation.

---

## Configuration

Settings are managed in `~/.claude-mem/settings.json` (auto-created with defaults on first run). Configure AI model, worker port, data directory, log level, and context injection settings.

See the [configuration guide](docs/public/configuration.mdx) for all available settings and examples.

### Mode & Language Configuration

Copilot-Mem supports multiple workflow modes and languages via the `CLAUDE_MEM_MODE` setting.

This option controls both:
- The workflow behavior (e.g. code, chill, investigation)
- The language used in generated observations

Edit your settings file at `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_MODE": "code--zh"
}
```

Modes are defined in `plugin/modes/`. Language-specific modes follow the pattern `code--[lang]` where `[lang]` is the ISO 639-1 language code (e.g., `zh` for Chinese, `ja` for Japanese, `es` for Spanish).

| Mode | Description |
|------------|-------------------------|
| `code` | Default English mode |
| `code--zh` | Simplified Chinese mode |
| `code--ja` | Japanese mode |

Restart VS Code after changing the mode to apply the new configuration.

---

## Worker Management

Hooks start the worker automatically, but you can manage it manually:

```bash
npx copilot-mem status   # check worker status
npx copilot-mem start    # start the worker
npx copilot-mem logs     # inspect worker logs
```

---

## Troubleshooting

**Hooks don't fire:** Confirm the plugin appears under the agent plugins view and is enabled, and check the **Output → Chat Hooks** channel in VS Code for errors.

**No context injected:** Context appears from the second session onward — the first session only captures observations.

**Worker not running:** Start it manually with `npx copilot-mem start` and inspect logs with `npx copilot-mem logs`.

See the [troubleshooting guide](docs/public/troubleshooting.mdx) for more.

---

## Development

```bash
npm install
npm run build           # build hooks and plugin manifests
bun test                # run tests
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Update documentation
5. Submit a Pull Request

---

## License

Copilot-Mem is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for full details and attributions.

**Note on Ragtime**: The `ragtime/` directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/ramikhafagi96/copilot-mem/issues)
- **Repository**: [github.com/ramikhafagi96/copilot-mem](https://github.com/ramikhafagi96/copilot-mem)
