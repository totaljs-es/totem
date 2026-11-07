# Agent loop and tools

## The loop (`modules/agent.js`)

```
run(session, message)
  messages = system prompt + instructions + history + message
  repeat
    stream the model answer          → events: text and reasoning deltas
    collect tool calls
    if none: finish
    for each tool call
      permission check               → may ask the user and wait
      run the tool action            → events: tool start / end
      append the tool result
  until finish, abort or step limit
```

Design points:

- **One model call per step.** A step is one request to the provider; its answer holds text, reasoning and zero or more tool calls. Calls of one step run in order unless the tool is marked read-only, in which case they run together.
- **Streaming first.** The loop uses `AIMODEL(name)...stream(fn)` and forwards each delta. The provider-specific parsing is the framework's (`AIPARSER`).
- **Abort is a first-class state.** Aborting cancels the stream, kills running child processes and stores the partial answer.
- **Step limit.** A session has `maxsteps` (default 50). Reaching it ends the run with a visible reason, never silently.
- **Retries.** A failed provider call retries with backoff for transient errors (network, 429, 5xx) and stops on authentication or invalid request errors.
- **Context size.** Before each call the loop estimates tokens. Over the model limit it compacts: old tool results are replaced by a one-line summary, then old turns by a model-written summary. The stored history is never rewritten; compaction produces a derived message list.

- **Rejections end a run.** After three rejected or denied actions in a row the run stops with a note in the conversation, so a model that keeps trying the same edit cannot loop until the step limit.

## Tried with real models (Ollama, 2026-11-06)

| Model | Result |
|---|---|
| `qwen3:4b` | Calls `read` and `edit` through the OpenAI-compatible endpoint, streams reasoning (stored as a collapsed `reasoning` part) and answers correctly. Slow on CPU (about 30 s for a read and an answer). After a rejected edit it tried again, which led to the rule above |
| `qwen2.5:1.5b` | Did not call the tool and invented the content of the file. Too small to use tools reliably; the model catalogue (phase 3) should mark which models support tools |

## Providers: what is verified

| Provider kind | Verified |
|---|---|
| OpenAI-compatible (Ollama) | Real server, 2026-11-06: streaming, tool calls, reasoning, usage |
| Anthropic | The request shape matches the official pages (checked 2026-11-06): `x-api-key`, `anthropic-version`, `max_tokens`, top-level `system`, `tools[].input_schema`, `tool_use` and `tool_result` blocks with all results of a turn in one user message, stream events, `/v1/models`. Exercised only against a simulator built from them. We send `anthropic-version: 2023-06-01`; the pages show a newer value in their examples and mark the header optional |
| Gemini | Exercised only against a simulator. Not confirmed from the pages: `alt=sse`, the `x-goog-api-key` header, the role of function responses (`user` is sent), `pageSize` of the model list. `thoughtSignature` exists in the API and is sent back |

Neither Anthropic nor Gemini has been run with a real key yet.

## Providers: LiteLLM and the others

LiteLLM (https://www.litellm.ai, an open-source AI gateway) is a provider of kind `litellm`. It is listed with the remote providers, not as a model of this computer, and Totem still looks for a proxy on port 4000 of this computer when it searches for local servers (`detect` in its template). Requests go to the OpenAI-compatible address of the proxy: requests go to its OpenAI-compatible address, and the model list comes from `/model/info` (context window, tools, reasoning and price of each model, one entry per name), falling back to `/models` when the proxy does not answer it. It was tried with a real proxy (the `main-stable` image of LiteLLM with the master key, in front of Ollama with `qwen2.5:1.5b`): the list, the key and the chat work. What the real proxy taught: `/model/info` answers `null` for the context, tools and price of a model that Ollama serves, so Totem shows them as unknown; a proxy with a master key answers 401 to the search of local servers, so it is added from the list of providers with its key; a model of Ollama must be written `ollama_chat/<model>` in the config of LiteLLM (with `ollama/` the model answers with JSON instead of text); and Ollama behind a gateway cuts the prompt at its own window (2048 or 4096 tokens), which takes the instructions away from the model, so Totem sends `num_ctx` and `repeat_penalty` in the request when `/model/info` says that the model behind the name is an Ollama one (`underlying`), and the limit of answers of a small model as `max_tokens`. The templates also include vLLM, xAI, Fireworks, Cerebras, Hugging Face, NVIDIA NIM, Moonshot and Cohere; their addresses answered a request without a key (401, 403 or 200), but none has been tried with a key. Perplexity is not in the list: it has no list of models. Any other OpenAI-compatible server is added with "Other".

## Vague requests

The base prompt tells the agent to use the `ask` tool when it does not know what to build or what it is for, and to work without asking when the request is clear. With `qwen3:4b` the request "quiero hacer un componente jcomponent" now ends in a question with options (counter, form, list, other), and "create the file public/js/sum.js with a function sum(a, b)" goes straight to `write`. Small models may not follow it.

## The prompt

Built in this order; each part is a file or a function, never a hidden string:

1. Base prompt (`private/prompts/base.txt`): role, how to use tools, how to answer.
2. Environment: working directory, platform, date, whether the folder is a git repository.
3. Instructions found in the project: `AGENTS.md` and its pointers, loaded from the project root and, when the agent reads a file, from that file's folders.
4. Skills: name and description of each available skill; the body loads when the agent asks for it.
5. The tool definitions.

## Tools are actions

Each tool is a `NEWACTION` in `schemas/tools-*.js` named `Tools|verb`. The model-facing definition comes from the action itself (`toAITool()`), so the input declaration is written once and serves validation and the model.

```js
NEWACTION('Tools|read', {
	name: 'Read a file',
	summary: 'Reads a text file of the project, optionally a range of lines.',
	input: '*path:String // Path relative to the project root, offset:Number // First line, limit:Number // Number of lines',
	action: function($, model) {
		// resolves the path inside the project root, reads, returns numbered lines
	}
});
```

Notes:

- `toAITool()` produces arguments nested as `input` / `query` / `params`. The loop flattens them for the model (tools use `input` only). `ACTION(name, payload)` receives the flat payload as the input.
- Field comments after `//` are the argument descriptions the model sees.
- Tools are **not** exposed through `/$mcp/` by default. File and shell tools behind a network endpoint are a risk; `mcp: true` is a per-tool setting that stays off until someone turns it on.
- Whether a tool is read-only is not an action property of the framework. The loop keeps it in one list in `modules/agent.js` (design).
- The runtime context (project root, session, user) travels with the call as `.user(user)` plus the action `env`/options, never as global state.

### Core tools

| Tool | Does | Read-only |
|---|---|---|
| `Tools\|read` | Reads a file or lists a directory | yes |
| `Tools\|glob` | Finds files by pattern | yes |
| `Tools\|grep` | Searches content (uses the system `rg` when present, a built-in search otherwise) | yes |
| `Tools\|write` | Creates or replaces a file | no |
| `Tools\|edit` | Replaces an exact string in a file | no |
| `Tools\|patch` | Applies a multi-file patch | no |
| `Tools\|bash` | Runs a shell command with timeout and output limit | no |
| `Tools\|fetch` | Fetches a URL as text or Markdown | yes |
| `Tools\|todo` | Keeps the visible task list of the session | no |
| `Tools\|ask` | Asks the user a question and waits | no |
| `Tools\|task` | Starts a sub-agent with its own context ([capabilities](capabilities.md)) | no |
| `Tools\|skill` | Loads the body of a skill | yes |

Every file tool: resolves paths against the project root, refuses anything that leaves it, records a snapshot before changing a file, truncates large output and says it truncated.

### Tools from outside

Tools from MCP servers (stdio and HTTP) are registered at session start by `modules/mcpclient.js`. They appear to the loop as tools named `server_tool` and pass through the same permission check.

## Sub-agents (implemented)

`Tools|task` (`modules/subagent.js`) starts a nested run with a fresh context, the tools of its definition and its own step limit; only its final answer returns to the parent. Its tool calls use the same permission check, so a question appears in the session of the user; its progress is shown in the output of the `task` call; aborting the session stops it. It cannot start other agents. Agent definitions are files (`.totem/agents/*.md` in the project, `private/agents/*.md` built in: `explore`, read-only, and `general`) with a name, description, `tools`, `maxsteps` and a prompt.

## Commands

A file `.totem/commands/<name>.md` with a `description` and a prompt becomes `/name arguments`. `$ARGUMENTS` in the prompt is replaced by the arguments. The conversation shows what the user typed; the model receives the expanded text, also in later turns. The chat shows the commands of the project as chips above the prompt box. Text that starts with `/` but is not a command of the project is sent as it is.

## Total.js by default

Totem writes Total.js 5 and jComponent 20 unless the project is clearly something else. With `totaljs : auto` in the `config` (the default) a project is a Total.js project when its `package.json` depends on `total5`, or when the folder is new: no `package.json` and no file of another kind of project (`pom.xml`, `Cargo.toml`, `go.mod`, `pyproject.toml`...). `always` and `never` decide for every project.

In a Total.js project the system prompt carries a primer (`private/prompts/totaljs.txt`): the shape of a project, one action, one route, one jComponent, the rules, a warning that jComponent is not Java Swing, and the instruction to look things up instead of inventing functions. The sub-agents get it too.

**Forge in front of the prompt.** When the Forge server is connected, Totem searches Forge with the prompt before the first step: the filler words are dropped (Spanish and English), the Spanish words of the topic are translated, the search is limited to the product the prompt is about (jComponent or Total.js 5), and a request to make a component asks for the recipe that writes one. The two best pages (`forgepages`, `forgechars` characters each) go into the system prompt and the other results are listed for the page tool. The conversation shows which pages were used. A short prompt ("hola") and a command are not searched. A small model that does not call tools well then starts from the documentation: with `qwen2.5:1.5b` the question "quiero hacer un componente jcomponent" went from a Java Swing class to a `COMPONENT()` with `self.make` and `self.setter`.

## Knowledge for Total.js projects

In a Total.js project Totem adds three more things, each one switched off with `forge : false` or `conventions : false` in the `config`:

1. **The conventions skill** (`private/skills/totaljs-conventions`; the primer already carries the short form): the rules of the conventions in short form and how to look things up. A skill of the project with the same name replaces it.
2. **Forge as an MCP server** (`private/mcp.json`): the tools `forge__Forge_search`, `forge__Forge_page`, `forge__Forge_verify_api`, `forge__Forge_source` and three more of https://forge.totaljs.es/mcp/ (read only, no account). Like every MCP server it asks before it starts, and the question says where it goes; the searches are sent to that site. A project replaces it by declaring a server named `forge`.
3. **The check of the conventions on every file that `write`, `edit` and `patch` produce** (`private/conventions/check.js`, a copy of `tools/check.js` of the conventions repository): the findings come back in the result of the tool so that the model corrects them. Projects that do not depend on `total5` are not checked.

## MCP servers (implemented)

The tools of MCP servers declared in `.totem/mcp.json` (`command` and `args` for stdio, `url` and `headers` for HTTP) join the tools of the agent as `server__tool`. A project file can start a program, so each server asks first (`mcp-start`), and each of its tools asks before it runs. The programs stop when the run ends. The sub-agents do not get MCP tools. Totem does not expose its own tools as an MCP server.

## Thoughts in the text

Some models that think (qwen3 on Ollama, with the thinking switched off too) write their thoughts into the text and end them with `</think>`. For a model that is known to think, the start of the text waits for that tag: what came before it becomes a reasoning part, what follows is the answer. Without the tag the text is released when the step ends (or after 40,000 characters), so a model that answers directly only shows its text at the end of the step.
