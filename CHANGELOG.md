# Changelog

## 0.1.7

- A new look for the workspace: warm light and dark themes, a sidebar with the actions at the top and the sessions grouped by project with a status dot, a short top bar with a *more* menu for what is not used all the time, a rounded prompt card, and a sidebar that slides in on narrow screens.
- Settings per workspace: the file config stays as the defaults and the values of limits, temperature, the knowledge of Total.js and the checks can be changed for all projects, one project or one session (Settings, and *Session settings* in the conversation). They are kept in the NoSQL data of Totem linked to the id, not in the repository, and a run uses `config < all < project < session`. Secrets, the address and the settings that start a program cannot be changed from Totem.
- Sub-agents in the workspace: an *Agents* panel (in the conversation and in Settings) lists the built-in, saved and file agents and edits the saved ones, for one project or for all of them, in the data of Totem. An agent can have its own model, several agents asked for together work at the same time, and the chat keeps what each agent did above its answer.
- Fixed: opening a session with a click stored the click event as the current project.
- Documentation from Forge: pages are ranked also by the API names and tags of `knowledge.json` (a prompt with `CRON` or `NEWACTION` finds its page), and a long page keeps its start and the blocks the request asks for instead of its first 3500 characters. A block of code is never cut in half.

## 0.1.6

- Answer review publishes one final revision rather than a draft followed by a correction. Raw complete HTML gets a code fence, safe indentation fixes do not need a model call, and scripts inside HTML are syntax checked even when strings contain translation markers.
- Every valid code block offers saving to a project path. Copy and Save preserve the original source and tabs. Outstanding findings and truncated answers show a review notice and are not saved automatically.
- Complete-page and message-card recipes distinguish browser components from server components and retain the preceding request on HTML follow-ups. Small models use one focused reference for these UI tasks and for new application starters.
- Explicit requests to create an application in a new folder start with native Total.js files under the normal write permissions; the model receives their results and continues with remaining features. Named-file fallback handles up to 24 files and returns diagnostics to the model.
- Plan refuses bash and MCP execution; unsafe command options no longer pass the default read-only command rule, and search skips protected env files.

## 0.1.5

Totem with a model of 1 GB, used the way a person uses it.

- **Forge without MCP:** the documentation of Forge comes from its `llms.txt` and its pages in Markdown, read with a GET. The search runs in Totem, so the prompt is not sent anywhere, there is no server to start and no permission to ask (the first "Hola" no longer stops at a question). The MCP server is the fallback, and an extra with `forgemcp : true`. `forgedocs : false` turns it off.
- **Small models** (up to 4 billion parameters, also behind LiteLLM or another gateway): the code of their older answers is left out of the history, their answers have a lower limit (`ollamapredictsmall`), a request to show something with a recipe in front of them goes without tools, and when they answer a request to make files with the code, the files that do not exist yet are written with the write tool. The correction of their code stays on and its request no longer carries the reminder of the style.
- **Save as:** every code block that starts with its path (`// schemas/system.js`) has a button that saves it as that file. A file that exists is replaced only if you confirm, and the old content stays in Undo.
- **`/new <name>`** creates the files of a minimal Total.js 5 application. **`/init`** with a small model writes `AGENTS.md` from the files of the project instead of asking the model.
- **Recipes:** system information (`Total.Os`) and starting an application, and the Spanish is understood in any form (autenticados, protejo, usuarios).
- **The write tool** leaves out a first line that only names the file and would break it (`# index.js` in a `.js` file).
- **LiteLLM:** tried with a real proxy in front of Ollama. The model behind the name is read from `/model/info`, and Totem sends the window (`num_ctx`) that Ollama needs behind a gateway. In the config of LiteLLM write `ollama_chat/<model>`.
- **Tests:** `idle()` waits for the idle of the run that was just started. 498 tests.
- Knowledge evaluation with `qwen2.5:1.5b`: 20/29 (it was 18/29).

## 0.1.4

A small model no longer answers a greeting with a code example.

- **Primer:** the two code examples are gone from the system prompt: the recipes bring the code when a request is about it. A greeting, a thanks or a question that is not about code gets a short answer.
- **Reminder:** "answer with the code" is no longer added to commands (`/init`) or to prompts shorter than 12 characters.
- **Tests:** `idle()` waits for the idle of the run that was just started.
- Knowledge evaluation with `qwen2.5:1.5b`: 18/29 (it was 16/29).

## 0.1.3

A small local model no longer answers every prompt with the same example, and `/init` no longer loops.

- **History:** with an Ollama model the code of older answers is left out of the history (`lighthistory`, on by default), because a small model copies it for any prompt. The last turn keeps its code.
- **Recipes:** a recipe that the last turn showed is not put in front of the model again.
- **Commands:** `/init` and other commands look nothing up in Forge and are not checked against the conventions. An answer that the token limit cut is not checked either, so the model is not asked to write it again.

## 0.1.2

The page of the package says what the repository says.

- **README:** the link to the new website, a screenshot, and the install with npm and with `docker pull`.
- **Package:** `homepage` points to the website (<https://totaljs-es.github.io/totem/>).
- **Website:** it lives in its own branch, `site`, and is not part of the package or the image.
- No change in the application.

## 0.1.1

Totem installed from npm runs like an installed program.

- **The `totem` command:** `totem` (or `totem 4524` for another port) starts the server in the background, shows the banner and where it listens, opens the browser and gives the terminal back. New: `totem stop`, `totem status` and `totem restart`. `totem serve` keeps the server in the terminal until Ctrl+C. When it cannot start it says why (port in use, no permission, a broken installation) and where the log is.
- **Installed from npm:** `totem` starts the application without the development watcher, so nothing is written in the folder of the package and a package in a read only folder (a global install by an administrator) works. The data already went to a folder of your user.
- **Publishing:** the workflow no longer fails when npm already has the version that was published by hand.
- No other change in the application.

## 0.1.0

The first version.

- **The agent:** reads, searches, edits, patches and runs commands in the folder of a project, and cannot leave it. Every file change and command asks first. Plan mode only reads; Build mode changes things. Diff of each step, undo and redo, background commands, sub-agents, `/commands` and `/init`.
- **Models:** Ollama, LM Studio and llama.cpp on your computer are detected; OpenRouter, OpenAI, Groq, Mistral, DeepSeek and any OpenAI-compatible server are in the list. The formats of Anthropic and Gemini are written and tested against simulators, not yet with real keys. Small models get a real context in Ollama, a low temperature, a stop to loops and a retry when they answer nothing.
- **Total.js knowledge:** recipes, the pages of Forge for each request, the conventions as a skill, a check of what is written (syntax, style, invented functions) and a correction of the code in the answers. An evaluation with 29 cases measures it with any model.
- **Interface:** projects and sessions, streaming chat, copy button on code boxes, attachments, split diff, git state, a terminal with an interactive shell (macOS and Linux), scheduled prompts, sessions in git worktrees, light and dark theme, English, Spanish and Slovak.
- **Protocols:** a client of MCP tools and prompts, and Totem as an MCP server (off by default).
- **Security:** secret files ask first, keys and the token never reach the model, a server that listens beyond this computer refuses to start without a token, strict cookie, same-origin checks and security headers.
- **Delivery:** the `totem` command, a Docker image that runs as a user that is not root, and the package `totaljs-totem` (the data goes to a folder of your user when it is installed from npm).
