# Changelog

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
