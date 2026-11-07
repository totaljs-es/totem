# Roadmap

Each phase ends when its condition is true, shown by a test or a demonstration, not by the list of work done.

## Phase 0: design

Pages in `docs/`, the repository skeleton, `AGENTS.md`, the conventions check. **Done when** the pages are reviewed and the open decisions of phase 1 are closed.

## Phase 1: the smallest working agent

- Application skeleton in the Total.js 5 layout, `config`, login for one local user.
- One provider through `NEWAIMODEL` (OpenAI-compatible, which reaches OpenRouter; Ollama second).
- Tools: read, glob, grep, write, edit, bash as `Tools|...` actions.
- The loop with streaming, abort and step limit; sessions and parts stored in NoSQL.
- Permission rules with ask/allow/deny and the project boundary.
- Interface: projects, chat with parts, permission questions, settings for one provider, file tree.

**Done when** a native test starts the server with a disposable data folder and a scripted fake provider, sends a prompt, and verifies the whole chain (stream events, a file edit, a permission ask, abort), and a manual session with a real model edits a Total.js project and the project still starts.

## Phase 2: review, context, daily use (implemented, see the notes below)

- Snapshots, per-session diff, undo; git status; auto-accept mode.
- `AGENTS.md` instructions, skills, patch/fetch/todo/ask tools, compaction, retry.
- Output secret scanning; terminal output panel; shortcuts, themes, translations.
- `totem` and `totem run`.
- The Total.js skill pack and conventions check available to the agent.

**Done when** one week of real work on Forge and a Total.js app uses it without leaving for another tool, and the test suite covers undo, compaction and secret scanning.

Status: snapshots, per-session diff, undo, auto-accept, `AGENTS.md`, skills, patch/fetch/todo/ask tools, retry, two levels of compaction, secret scanning, the changes panel, shortcuts (`Esc` stops, `Alt+D` toggles changes), `totem` and `totem run` are in code with tests. Not done yet: more languages than English, Spanish and Slovak, and shipping the Total.js conventions skills with Totem. The week of real use has not happened.

## Phase 3: breadth (in progress)

Done: provider templates, detection of Ollama, llama.cpp and LM Studio on this computer, full model lists with context window, tool, reasoning and free flags (Ollama through `/api/show`, catalogues through `/models`), a model without tool support gets a request without tools, the context window of the model sets the compaction limit, token usage per step with a counter in the session bar. Anthropic and Gemini request formats are in code with simulator tests (not yet tried with real keys). Also done: cost per step from the price of the model, a reasoning effort control (sent to OpenAI-compatible servers), sub-agents, custom commands and the MCP client over stdio and HTTP. Also done: the design pass (IntranetCSS, light and dark theme, provider icons, logo for both themes) and the knowledge of Total.js projects (conventions skill, Forge over MCP, check of what the tools write). Also done: attachments (images and text files), the split view of the diff, questions replayed to a client that opens a session later, sessions that were running before a restart are marked as aborted, and a server that refuses images is retried without them. Also done: Plan and Build modes, formatters after edits, `/init`, a rule for secret files. Also done (simulators only): reasoning for Anthropic and Gemini. Also done: Totem as an MCP server (off by default).


- All five provider parsers, model catalogue, reasoning mode, token and cost counters.
- Sub-agents, custom commands, MCP client and server, attachments, split diff.
- Forge documentation search tool.

**Done when** each provider kind passes a recorded-stream test and an MCP server's tools are used in a session.

## Phase 4: depth

Interactive terminal (PTY), diagnostics after an edit. **Done when** the agent reads diagnostics after an edit and the terminal survives a reload.

Done: diagnostics from the checks of the project (not language servers, see decisions), and the interactive shell in the Terminal panel (pseudo-terminal from the Python standard library, survives a reload, plain text output). Pending: a terminal emulator for full-screen programs, Windows (phase 6), the same terminal as an independent tab without a session.

## Phase 5: shipping on servers

Docker image, scheduled prompts, worktrees for parallel sessions, multi-user hardening.

Done: the Docker image with a token as a Docker secret, a mounted project and the smoke test (`scripts/docker-smoke.js`, in CI with the unit tests); the server refuses to listen beyond this computer without a token; `--release` really runs without the watcher now. Also done: scheduled prompts (unattended runs, Plan mode by default, a dialog in the interface). Also done: worktrees for parallel sessions (create, merge, discard). Also done: hardening of a shared server (same-origin checks for requests and the WebSocket, strict cookie, constant-time token, security headers) and two bugs of the login page that kept a token-protected server from letting anyone in. Also done: the release workflow (`release.yml`) that publishes the package `totaljs-totem` and the image `ghcr.io/totaljs-es/totem` when a release is published on GitHub. Pending: the first release (0.1.0) and accounts with their own projects (a decision, see security). **Done when** the image runs from `docker run` with a token, with a mounted project, and the smoke test passes in CI.

## Phase 6: native windows

Shell, signed installers for macOS, Windows and Linux, update feed. **Done when** a tag produces installers that open, start the server and complete a session on each system.
