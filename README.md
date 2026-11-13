<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/img/totem-dark.svg">
    <img src="public/img/totem-light.svg" alt="Total.js Totem" width="128" height="128">
  </picture>
</p>

<h1 align="center">Total.js Totem</h1>

<p align="center"><b>An AI coding environment written as a Total.js 5 application.</b><br>Open a project, talk to an agent that reads your code, edits files and runs commands, and review every change. You choose the model: one on your computer, a free cloud one, or a paid one.</p>

<p align="center">
  <a href="https://github.com/totaljs-es/totem/actions/workflows/test.yml"><img src="https://github.com/totaljs-es/totem/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="https://www.npmjs.com/package/totaljs-totem"><img src="https://img.shields.io/npm/v/totaljs-totem" alt="npm version"></a>
  <a href="https://github.com/totaljs-es/totem/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022-3C873A" alt="Node.js 22 or newer"></a>
  <a href="https://github.com/totaljs/framework5"><img src="https://img.shields.io/badge/Total.js-5-3F8F2A" alt="Total.js 5"></a>
  <a href="https://forge.totaljs.es"><img src="https://img.shields.io/badge/jComponent-20-3F8F2A" alt="jComponent 20"></a>
  <a href="https://github.com/totaljs-es/totem/pkgs/container/totem"><img src="https://img.shields.io/badge/docker-ghcr.io-2496ED" alt="Docker image on ghcr.io"></a>
  <a href="https://github.com/totaljs-es/totem/tree/main/resources"><img src="https://img.shields.io/badge/languages-en%20%C2%B7%20es%20%C2%B7%20sk-informational" alt="Languages: English, Spanish, Slovak"></a>
</p>

<p align="center"><b><a href="https://totaljs-es.github.io/totem/">Website</a></b> · <a href="https://totaljs-es.github.io/totem/docs/getting-started.html">Getting started</a> · <a href="https://totaljs-es.github.io/totem/docs/guide.html">User guide</a> · <a href="https://totaljs-es.github.io/totem/docs/help.html">Help</a></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://totaljs-es.github.io/totem/img/shots/chat-dark.webp">
    <img src="https://totaljs-es.github.io/totem/img/shots/chat-light.webp" alt="Totem answering a question about Total.js with an action and a route" width="900">
  </picture>
</p>

Totem is one application with three ways to run: a command, a Docker container and (next) a native window. The server is plain Total.js: actions, a few controllers, NoSQL for its own data, and jComponent 20 for the interface. There is no build step.

## What you get

- **An agent with tools.** It reads, searches, edits, patches and runs commands in your project folder, and it cannot leave it (every path is resolved inside the project, symbolic links included).
- **A whole application in small tasks.** `/project` turns a request into a short plan, and `/build` walks its tasks one by one: each file is written with only what it needs in front of the model, and checked before the next. A model of 4B that could not hold the application in its head does not have to. See [projects](docs/projects.md).
- **You stay in control.** Every file change and command asks first, unless you allow it. **Plan mode** only reads and describes; **Build mode** changes things. See the diff of each step, undo it, redo it.
- **Any model.** Ollama, LM Studio and llama.cpp on your computer are detected for you; OpenRouter, OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek and a dozen more (any OpenAI-compatible server) are in the list. Prompts go only to the providers you add.
- **It knows Total.js.** In a project that depends on `total5` the agent gets the recipes of Totem, the pages of the [Total.js library](https://github.com/totaljs-es/knowledge) and of [Forge](https://forge.totaljs.es) for your request, the conventions as a skill, and a check of everything it writes: syntax, style, invented functions. Small local models get focused examples; the quality of an application still depends on the model and needs testing.
- **Sub-agents.** Helpers with their own context, tools and model that the main agent hands a task to; several work at the same time, and the *Agents* panel adds yours.
- **Work in parallel.** Sessions can run in their own **git worktree**, and **scheduled prompts** run by themselves, unattended and read-only unless you say otherwise.
- **A terminal that stays.** An interactive shell in the project folder that survives a page reload, and background commands the agent can start and read.
- **The hands of a larger model.** Claude Code, Codex or another agent writes the plan of an application and reviews the result, and Totem writes the files with the model of your computer: `totem project`, `totem build` and a few lines back, so the tokens that cost money are not spent on the files. Give the other agent the address `/agent/` and it reads how. See [projects](docs/projects.md).
- **Open protocols.** A client of MCP servers (tools and prompts) for the agent, and Totem itself as an MCP server for other agents (off by default).
- **Careful with your machine.** Configured keys are masked, `.env` reads ask first, a shared server needs a token, and the Docker image runs without root.
- **Your language.** English, Spanish and Slovak, chosen in Settings.

## Quick start

Three ways: **npm** (below), **Docker** (`docker pull ghcr.io/totaljs-es/totem:latest`, see [Docker](#docker)) or the **source**.

### With npm

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install -g totaljs-totem
totem            # starts Totem in the background and opens the browser
totem 4524       # the same, on another port
totem stop       # stops it
```

The browser opens on <http://127.0.0.1:8000>, and the terminal is yours again. Installed from npm, your data (providers, projects, sessions) lives in a folder of your user (`totem config` prints it) and not in the package, so an update never touches it.

### From the source

```bash
git clone https://github.com/totaljs-es/totem.git
cd totem
npm install
node index.js 8000
```

### Then, in the browser

Press **Settings** and add a model:

- **A model on your computer.** Install [Ollama](https://ollama.com), pull a model (`ollama pull qwen2.5-coder`), and press *Look for servers on this computer*.
- **A cloud model.** Add a provider, paste the key (it is stored encrypted on your computer and never shown again) and choose the models you want.

Then **Open a folder**, write what you want, and watch it work.

### The `totem` command

```bash
totem run "explain this project" --project ~/code/app --model ollama:qwen2.5-coder
```

(From a clone, `npm link` makes the `totem` command.)

| Command | What it does |
|---|---|
| `totem [port]` | Starts the server on port 8000 (or the one you give: `totem 4524`) **in the background**, shows where it listens and opens the browser. The terminal is free |
| `totem start [port]` | The same, without opening the browser (`--port 4524` also works) |
| `totem stop` | Stops the server that `totem` started |
| `totem status` | Says if it runs and where (pid, address, log) |
| `totem restart` | Stops it and starts it again, on the same port |
| `totem serve [port]` | Runs the server in this terminal until Ctrl+C (for a server, a script or when you develop Totem). `--verbose` shows its whole output |
| `totem run "prompt" [options]` | One prompt without the interface: the answer goes to stdout, the tool calls to stderr, the exit code says if it finished |
| `totem project "card or request"` | Keeps the plan of a whole application in the project (`--project <folder>`); the answer is a few lines |
| `totem build` | Makes the tasks of the plan that are not done, one file each, and says what is done and what failed (`--wait` waits for the end) |
| `totem plan` | Prints the plan and the state of its tasks |
| `totem config` | Prints the folders that Totem uses |

Options of `run`: `--project <folder>`, `--model <provider:model>`, `--url <server>`, `--token <token>`, `--auto-accept` (file edits run without asking), `--yes` (every other question is answered "allow once"). Without `--url` a temporary local server is started. `--data <folder>` chooses where the data goes.

### A whole application

In the conversation, `/project` and then `/build`:

```
/project a helpdesk with tickets and customers
/build
```

`/project` keeps a short card (the plugins of the application and the fields of each one) and `/build` makes its tasks one by one: the files that every application has, and for every plugin its routes, its actions, its screen and its form. Each task writes one file with only what it needs in front of the model, and it is checked before the next. At the end, `npm install` and `node index.js 8000`.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://totaljs-es.github.io/totem/img/shots/project-dark.webp">
    <img src="https://totaljs-es.github.io/totem/img/shots/project-light.webp" alt="Totem building an application task by task, one file each" width="900">
  </picture>
</p>

Another agent can drive it and save its own tokens: `totem project`, `totem build` and `totem plan` from a terminal, or the address `/agent/` of a running Totem, which explains itself in plain text. See [projects](docs/projects.md).

### Docker

```bash
docker pull ghcr.io/totaljs-es/totem:latest
```

Then run it with a token and your project mounted:

```bash
echo "a-long-random-token" > token.txt
docker run --rm -p 127.0.0.1:8000:8000 \
  -v "$PWD/token.txt:/run/secrets/totem_token:ro" \
  -v "$PWD:/workspace/project" \
  -v totem-data:/data ghcr.io/totaljs-es/totem:latest
```

Open <http://127.0.0.1:8000>, sign in with the token, and open the folder `/workspace/project`. The image is for `linux/amd64` and `linux/arm64`. The tags are `latest`, the exact version (`0.1.1`) and the minor (`0.1`): pin one when you want updates only when you choose. The page of the image is [on GitHub](https://github.com/totaljs-es/totem/pkgs/container/totem).

The container listens on all interfaces, so it **refuses to start without an access token**. Your projects are mounted under `/workspace`, the data is a volume, and everything runs as a user that is not root, which makes it the isolated way to try untrusted models. There is a [compose example](docs/docker-compose.yml) and the [delivery notes](docs/delivery.md). To build it yourself: `docker build -t totem .` in a clone.

## The interface

| | |
|---|---|
| **Projects** | Folders with their sessions. Click one to continue, `+` for a new session, the menu for a named session or one in a **git worktree**. Rename with a double click. |
| **Chat** | Streaming answers, the thinking of the models that think, a copy button on every code box, attachments (images and text files), the `/commands` of the project and `/init` to write an `AGENTS.md`. |
| **Changes** | The files the agent changed, unified or split diff, **Undo** and **Redo**, the git state of the folder, and for a worktree session **Merge into the project** or **Discard**. |
| **Terminal** | The commands the agent ran, the ones in the background, and an interactive **Shell** (macOS and Linux). |
| **Agents** | The sub-agents the main agent can hand a task to: the built-in ones, the ones you save (for one project or for all) and the files of the project. |
| **Scheduled prompts** | The clock next to Settings: a prompt every N minutes or every day, in a new session, unattended. |
| **Settings** | Theme (light, dark, auto), language, providers and models with their abilities, and the values of the agent (limits, temperature, the knowledge of Total.js, the checks) for all projects, one project or one session. |

## Choose the model

Totem works with a 1.5B model and with the biggest ones. A few tips:

- **Small models on your computer** follow instructions better with a low temperature (`temperature : 0.2` in `config`, already the default for servers on your computer) and enough context: Ollama is asked for at least 16384 tokens, and for more when the request needs it, because its own default silently cuts the instructions.
- **A model that loops** (repeats one paragraph until the context is full) is stopped by a repeat penalty and a limit per answer (`ollamarepeat`, `ollamapredict`).
- **Reasoning models** get a *Reasoning* control. The Anthropic and Gemini formats are written and tested against simulators, not yet with real keys: try them and tell us.

## How it knows Total.js

When the project depends on `total5` (or is a new folder), Totem puts four things in front of the model:

1. **Recipes** ([`private/recipes/`](private/recipes)): short, exact answers for the common tasks (routes, actions, NoSQL, config, `RESTBuilder`, auth, CRON, WebSockets, views, jComponent, plugins...), chosen by the words of your request. They work offline and follow the conventions to the letter.
2. **The library** ([totaljs-es/knowledge](https://github.com/totaljs-es/knowledge)): conventions, questions and answers, tested applications and the catalogue of jComponent components and Total Icons, read live from its public index. The page that matches the request goes to the model.
3. **Forge** ([forge.totaljs.es](https://forge.totaljs.es)): matching documentation fetched from its public index and Markdown pages, ranked together with the library. Small models use one focused recipe when it covers the task, and the pages when it does not. MCP is optional.
4. **A check of the code**: what the agent writes is checked against the [Total.js conventions](https://github.com/totaljs-es/conventions) (syntax, ES5, tabs, names with `|`, texts as `@(English)`, no invented functions) and the model fixes what is wrong. The code in an answer is checked too, and corrected once.

To measure it with any model:

```bash
node scripts/knowledge-eval.js --model ollama:qwen2.5:1.5b --runs 3 --out result.json
```

It asks 29 questions about Total.js and jComponent in a temporary project and scores the answers: what must and must not appear, and the quality of the code. See [knowledge](docs/knowledge.md).

## Configuration

Settings live in the file [`config`](config) (never in environment variables). The ones you will touch:

| Setting | Default | What it does |
|---|---|---|
| `$ip` | `127.0.0.1` | The address it listens on. Anything else needs `token` |
| `token`, `tokenfile` | empty | The access token, or a file that has it (a Docker secret) |
| `temperature` | `0.2` | For the models on your computer |
| `ollamactx`, `ollamactxmax` | `16384`, `32768` | Context asked to Ollama |
| `maxsteps`, `bashtimeout` | `50`, `120000` | Limits of the agent loop |
| `totaljs` | `auto` | `always` or `never` to decide for every project |
| `forge`, `forgedocs`, `library`, `recipes`, `selfcheck`, `conventions` | `true` | The parts of the Total.js knowledge (`forgedocs`: the documents of Forge, with no MCP server; `library`: the Total.js knowledge repository, read live) |
| `forgemcp` | `false` | The MCP server of Forge as an extra (it asks to start) |
| `selfchecksmall` | `true` | The correction of the code is asked from models up to 4B too |
| `formatter`, `diagnostics` | `true` | Run the formatter and the checks that the project already has after a write |
| `terminalshell` | empty | The shell of the Terminal (empty: your `SHELL`) |
| `$mcp` | `false` | Totem as an MCP server for other agents |

A project can add a `.totem/` folder with `formatters.json`, `diagnostics.json`, `mcp.json`, `instructions.json`, and `agents/`, `commands/` and `skills/`.

## Security in a few lines

- The agent acts through tools only, each checked before it runs. Plan mode refuses writes and commands in code, not in a prompt.
- Files with secrets (`.env`) ask first; keys and the token are scrubbed from everything the model sees.
- A server with a token compares it in constant time, uses a strict cookie, refuses requests from other origins, and sends headers against framing.
- The shell and the commands run with your permissions: they protect against mistakes, not against a hostile model. For that, use the Docker image.

The details, including the honest limits (one token, one user), are in [security](docs/security.md).

## Help

| Problem | What to do |
|---|---|
| No model to choose | Settings → add a provider, or *Look for servers on this computer* with Ollama or LM Studio running |
| A small model seems to ignore the instructions | Check `ollamactx` in `config`: Ollama must get a real context. Totem asks for 16384 by default |
| `totem` says it could not start | It says why: the port in use (use `totem start 8001`), no permission to write the data, or a broken installation. The whole output is in `totem.log` in the data folder |
| The container does not start | It needs a token: mount a file at `/run/secrets/totem_token` (or set `token` in `config`) |
| "The terminal could not start" | The Shell needs Python 3 (macOS and Linux). It is in the Docker image |
| Docker cannot see your folder (Colima, Docker Desktop) | Share the folder with the virtual machine: your home folder, not `/tmp` |
| The agent asks to start Forge | It is the documentation connection. Allow it once for every project, or set `forge : false` |
| A worktree could not be created | The project needs git with at least one commit |
| Scheduled prompts do nothing | They run unattended: in Plan mode they only read, and anything that would ask is refused. Choose Build and auto-accept to let them edit |

Run the tests with `npm test` (about 50 seconds, with temporary folders: it never touches your data).

## Status

Phases 1 to 5 of the [roadmap](docs/roadmap.md) are built: the agent and its tools, the interface, the knowledge of Total.js, the terminal, diagnostics, the Docker image, scheduled prompts, worktrees and the hardening of a shared server. Version 0.1.0 is the first one published: the package [`totaljs-totem`](https://www.npmjs.com/package/totaljs-totem) on npm and the image `ghcr.io/totaljs-es/totem` for `linux/amd64` and `linux/arm64`. Still to come: native windows with signed installers (phase 6) and accounts with their own projects. See the [changelog](CHANGELOG.md).

## Documentation

The [website](https://totaljs-es.github.io/totem/) has the guide to get started, the user guide and the help, with screenshots. The pages that explain how it works:

[Vision](docs/vision.md) · [Architecture](docs/architecture.md) · [Agent loop](docs/agent-loop.md) · [Projects](docs/projects.md) · [Interface](docs/interface.md) · [Protocol](docs/protocol.md) · [Security](docs/security.md) · [Knowledge](docs/knowledge.md) · [Delivery](docs/delivery.md) · [Roadmap](docs/roadmap.md) · [Decisions](docs/decisions.md)

## Inspiration

Totem was inspired by [OpenCode](https://opencode.ai), and it is written from scratch to do something else: to be the coding agent of Total.js.

## License

[MIT](LICENSE). Made by the Spanish Total.js Platform.
