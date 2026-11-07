# Interface

Single-page application in the Total.js admin style: jComponent 20, plugins loaded on demand, English keys translated with the native resources. Components come from the catalogue through `COMPONENTATOR()`; a missing one is a reusable `COMPONENT()` in `public/`.

## Layout

```
┌────────────┬───────────────────────────────┬───────────────┐
│ Projects   │ Session                       │ Side panel    │
│  └ sessions│  messages and parts           │  Files        │
│            │  prompt box                   │  Changes      │
│            │                               │  Terminal     │
└────────────┴───────────────────────────────┴───────────────┘
```

## What exists (phase 1)

Three plugins, mounted by the shell `views/index.html` with `page` components named by their `if` value (`projects`, `chat`) and two importers for the forms. Forms loaded by an importer use `~PATH~` (the importer's `if` value), not `CLASS`, for `miniform` `if` and `plugin`.

| Plugin | Files | Does |
|---|---|---|
| `projects` | `index.html`, `form.html` | Projects and their sessions (each session shows the icon of its provider); open a folder with a folder picker; new session; forget a project; opens Settings |
| `chat` | `index.html` | Messages with parts (text as Markdown, tool calls with input and output), permission questions, prompt box, model picker, stop; subscribes to the session over WebSocket and renders events |
| `settings` | `index.html`, `form.html` | Providers: look for servers on this computer and add them with their models, add from a template (Ollama, llama.cpp, LM Studio, OpenRouter, OpenAI...), load the full model list of a provider with search and Tools / Free filters, choose the models; the API key is write-only |

The login page (`views/login.html`) is used only when `token` is set in `config`.

## Attachments

The paperclip next to the prompt box attaches images (PNG, JPEG, GIF, WebP, up to 5 MB) and text files (code, Markdown, JSON, CSV... up to 200 KB, at most 6 files and 12 MB together). They can also be pasted into the prompt box or dropped on the chat. The files wait as chips above the box until the prompt is sent; the conversation then shows the images and the names of the files. The text of a text file goes into the prompt inside a `<file name="...">` block; an image goes as an image to the models that can see (OpenAI-compatible, Anthropic and Gemini formats). A model that is known not to see (`vision: false` in its metadata) gets the text and a note instead of the image; a server that refuses images (Ollama says "does not support multimodal requests") makes Totem try again without them and remember it. The files are kept in `databases/attachments` and deleted with their session. The component `filebrowser` is used here, where it fits: it is the file chooser of the browser.

## Sessions

A session has a name. It can be given when the folder is opened (an optional field in the picker) or from the menu of the project (New session with a name); without one the session starts as "New session" and takes its name from the first prompt (one short line). A name written by the user is never replaced. The menu of each session (the dots that appear on hover) renames it or deletes it with its messages; the files of the project are not touched. Other clients see the change through the event `session.updated`.

## Choosing a folder

The folder of a project is chosen with the component `folder` (j-Folder), which browses the computer where Totem runs through `Folders|list`: a path bar, the folders of the current one, up, and shortcuts to Home, Volumes and Root. Only the names of folders are listed. The component `filebrowser` is not used: it is the file chooser of the browser, which never gives the path of a file on the computer, and a project needs a path. The picker uses `/` as separator; drives of Windows are not listed yet.

## Changes panel

`Alt+D` or the Changes button opens it. Each file can be shown as unified lines or as two columns (Split): the old file on the left in red, the new one on the right in green, with a removed block next to the block that replaces it. The panel widens in Split mode.

## Prompt box

Without a session there is nothing to talk to, so the chat shows "Open a folder to start" with a button. A prompt typed anyway creates a session in the selected project, or, with no project, says so and opens the folder picker; it never does nothing silently. `Enter` sends (the component `enter` with no delay). The text is read from the input at that moment, because the input copies its value to the model a little later than the key arrives.

## Design

- **IntranetCSS** (the component `intranetcss`) provides the base: `message`, `badge`, `caption`, `listing`, `toolbar`. Totem adds `public/css/default.css` with a few variables and its own buttons (`tbtn`, not `btn`, which jComponent already defines).
- **Dark theme.** IntranetCSS styles the class `ui-dark` of the body, which `APPEARANCE({ dark })` switches. Settings has Auto (follows the system), Light and Dark; the choice is kept in the browser.
- **Logo.** `public/img/totem-light.svg` (dark greens, for a light background) and `totem-dark.svg` (light greens) are shown with the class of the theme. The favicon and the app icons use the dark tile.
- **Provider icons.** `public/img/providers/*.svg` are drawn as a mask in the colour of the text, so they work in both themes. They are all the same: a viewBox of 24 by 24, the drawing scaled to fit in a box of 20 by 20 and centered, one colour (`currentColor`), no fixed size and no style; a test checks it. Drop a new icon in that folder and run `node scripts/normalize-icons.js` to make it like the others. Their sources and licences are in `public/img/providers/SOURCE.md`.

## Screens (plugins)

| Plugin | Shows | Notes |
|---|---|---|
| `projects` | Projects and their sessions, open folder | Opening a folder uses the server's folder browser (a path field and a tree) |
| `chat` | The conversation: text, reasoning (collapsed), tool calls, permission questions, todo list | Renders from parts and events; Markdown with code highlighting |
| `prompt` | Input, model picker, agent picker, attachments, auto-accept toggle | `@file` mention completes from the file tree; `/` lists commands |
| `files` | Tree and file viewer with line numbers | Read-only in phase 1 |
| `diff` | Changes of the session, per file, accept/undo per message | Unified first, split later |
| `terminal` | Output of commands run by the agent; later an interactive shell | See [decisions](decisions.md) for the PTY |
| `settings` | Providers, models, permission rules, appearance, language | Keys are write-only fields |

## Behaviour that matters

- The chat renders only from stored parts plus events, so reload, a second browser tab and a native window show the same thing.
- A permission question is part of the conversation, answered inline, and visible in every open client.
- The prompt box stays usable while a run is going: a new prompt queues, `Esc` aborts.
- Long output (commands, files) is collapsed by default, with a size note.
- Dark and light themes follow the system (`intranetcss` with its dark mode).

## Components to reuse

From the Forge catalogue (https://forge.totaljs.es/en/components/): `exec`, `input`, `form`, `miniform`, `importer`, `menu`, `message`, `approve`, `notify`, `search`, `viewbox`, `navlayout`, `listing`, `datagrid`, `markdown`/`cloudeditor` for viewing and editing, `shortcuts`, `loading`, `errorhandler`. Each is verified against the catalogue page before use; anything absent becomes a new component listed in the roadmap phase that needs it.

## Accessibility and language

Keyboard-first (shortcuts for send, abort, switch session, accept/undo), focus managed after each event, labels for every control, all text as `@(English key)` with translations in `resources/`.

## Streaming without flicker

Deltas are buffered and drawn at most once per frame. Only the open part is redrawn, the open or closed state of reasoning and tool blocks is kept, and the view follows the end only while the user is at the bottom; scrolling up stops the following until the user returns.

## Plan and Build

The box of the prompt has a Plan / Build selector. Plan only reads: the model gets the tools that read (`read`, `glob`, `grep`, `fetch`, `todo`, `ask`, `skill`, `task`) and an instruction to answer with a plan, and the permission check refuses `write`, `edit`, `patch` and any command that is not read-only, even with auto-accept. Build is the normal mode. The mode belongs to the session and travels with each prompt (`mode`); sub-agents inherit it.

## Commands that come with Totem

`private/commands/*.md` are available in every project; a command of the project with the same name replaces them. `/init` studies the project and writes or updates its `AGENTS.md`.

## Formatters

After `write`, `edit` and `patch` Totem runs the formatter that the project already has (a local `node_modules/.bin/prettier`, `gofmt` with `go.mod`, `rustfmt` with `Cargo.toml`, `ruff` with `[tool.ruff]`) or the ones in `.totem/formatters.json`: `{ "name": { "command": ["tool", "--write", "$FILE"], "extensions": [".js"] }, "disabled": ["prettier"] }`. The model is told when the file changed. `formatter : false` in `config` turns it off.

## Diagnostics

After `write`, `edit` and `patch` Totem runs the checks that the project already has and adds what they report to the result of the tool, so the model fixes a broken file in the same step: `node --check` for JavaScript, a parse for `.json`, a local `node_modules/.bin/tsc` with `tsconfig.json`, `go vet` with `go.mod`, `cargo check` with `Cargo.toml`, `ruff check` with `[tool.ruff]` and `python3 -m py_compile` for the rest of Python. `.totem/diagnostics.json` replaces or adds checks: `{ "name": { "command": ["tool", "$FILE"], "extensions": [".js"] }, "disabled": ["node"] }`. A check that exits with 0 says nothing, a tool that is not installed is skipped, and the report is capped at 3000 characters. `diagnostics : false` in `config` turns it off.

## Interactive terminal

The **Terminal** panel has a **Shell**: the shell of the user (`terminalshell` in `config`, else `SHELL`, else `/bin/sh`) in the project folder, inside a pseudo-terminal. The user opens it with **Open shell**, types in the line below the output (Enter, Tab for completion, the arrow keys for history, Ctrl+C or **Interrupt**) and closes it with **Close**. The model has no tool for it. The shell stays alive on the server: after a reload the panel reattaches to it and shows what it printed (the last 100000 characters). The output arrives as `terminal.output` and `terminal.exit` events of the session; removing the session or the project ends its shell. The pseudo-terminal comes from the Python standard library (`private/terminal.py`, `CONF.$python`), so there is no native module; it works on macOS and Linux. The panel shows plain text: it strips the control sequences and starts the shell with `TERM=dumb`, so full-screen programs (vim, htop) are not supported yet.

## Scheduled prompts

The clock button next to Settings opens **Scheduled prompts**: a prompt that Totem sends by itself, in a new session of a project, every N minutes (5 or more) or every day at HH:MM of the server. Each schedule has a project, a model, a prompt, a mode and an on/off switch; the list shows when it runs next and how the last run ended, and **Run now** starts it at once. Every run is a new session named after the schedule and the time, marked unattended. Nobody is there to answer, so it runs in **Plan** mode (it only reads) unless the schedule says Build; in Build mode the file edits need auto-accept, and everything else that would ask for permission is refused with a message to the model, and a question of the model is answered with "nobody is here". A schedule never starts while its previous run is still going, and a run that was going when the server stopped is marked aborted. The server checks the schedules once a minute.

## Worktrees

A session can work in its own git worktree, so that sessions that run in parallel do not change the same files: the project menu has **New session in a git worktree**. Totem makes a second checkout of the project in `.totem/worktrees/<id>` on a branch `totem/<id>`, from the branch that is checked out (the project needs git and one commit). The folder is kept out of `git status` through `.git/info/exclude`, never through a file of the project. Everything of the session (tools, snapshots, diff, shell, git box) works in the worktree. The Changes panel shows the branch, the commits that are not merged and the files that are not committed, with two buttons: **Merge into the project** commits what the session left and merges the branch into the branch that is checked out in the project (it asks for a project without uncommitted changes, and a conflict is undone, so the project stays as it was), and **Discard the worktree** removes the worktree and its branch. Totem never deletes work by itself: removing a session removes its worktree only when nothing would be lost (no uncommitted files, no commits that were not merged, no other session in it); a fork of the session shares the worktree. A session whose worktree was discarded does not run any more.

## Redo, fork and background commands

After an undo the bar shows Redo, which puts the changes back (the snapshots and the files of the undo are kept until the next prompt). Every answer has "Fork from here" and the menu of a session has Fork: the new session copies the conversation and its attachments, not the file changes. The `bash` tool takes `background: true` for a development server or a watcher: it returns at once with a job id and the first output, Stop does not end it, and the `job` tool lists the jobs of the session, reads their output and ends them (`stop`). Jobs end when the session is removed or the server stops.

## More instructions, rules of an agent, MCP prompts, notices

- `.totem/instructions.json` lists more instruction files of the project (`["docs/*.md", "CONTRIBUTING.md"]`, patterns allowed, at most 20 files); their text follows `AGENTS.md` in the system prompt. Only files inside the project are read: URLs are ignored, Totem does not fetch anything by itself.
- An agent file (`.totem/agents/name.md`) can have `allow:` and `deny:` lines with tool names. `deny` always wins and is checked after the project boundary and Plan mode; `allow` only removes the question for that tool (never for a chained command). The tools of a sub-agent are still the list in `tools:`.
- The prompts of the MCP servers that the user allowed to start are offered to the model as one tool, `mcp_prompt`, which lists them (`server:prompt`) and returns their text. Starting the server is what asks; reading a prompt does not.
- When the tab is in the background, the browser shows a notice when Totem finishes, stops with an error or asks for permission. The browser asks to allow notices the first time a prompt is sent; nothing is sent to any server.

## Sidebar

A click on a folder opens its latest session (a folder without sessions gets one); the `+` of the row starts a new one. The dots of every row are always visible, and a right click opens the same menu: rename, fork and delete a session, remove a folder from the list (the files are never touched). A double click on a session renames it. A name that is not a text is ignored, and sessions that an old bug named "[object Object]" are renamed after their first prompt when the list is read.

## Icons

The icon font is the one of `spa.min@20.css` (the Total.js icons, named `ti-...`), not the whole Tabler set: a name that is not in it shows nothing. `tests/icons.txt` lists the names of that file and a test checks every icon used in `plugins/` and `views/`.

## Git in the Changes panel

The top of the Changes panel shows the branch of the project and the files that git sees as changed (state, staged or not, at most 200), read with `git status --porcelain` through `Projects|git`. It only reads, with a timeout and a minimal environment, and shows nothing when the folder is not a git repository. The files of the session below it are still the ones that the agent changed, from the snapshots.

## Terminal panel

The Terminal button next to Changes opens a panel with every command that Totem ran in the session (`bash` calls with their state and output, as stored) and, above them, the commands running in the background, read again every two seconds while the panel is open, with a Stop link (`Sessions|jobs` and `Sessions|jobstop`). It is a record of what the agent ran, not a shell: an interactive terminal is phase 4.

## Languages

Every text of the interface is English inside the translation marker; Total.js translates it for each request with `resources/<language>.resource`. The language is the one chosen in Settings (the cookie `totemlang`), else the first language of the browser that has a resource, else English (`definitions/00-languages.js`; the list is `private/languages.json`). Plugins, views and API errors use the same resources. `node scripts/translations.js` lists the missing texts per language, `export <lang>` prints them as JSON to translate and `import <lang> <file>` writes them into the resource; a test fails when a language of the list misses a text. English, Spanish and Slovak are complete. To add a language, add it to `private/languages.json`, export, translate and import it.
