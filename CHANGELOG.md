# Changelog

## 0.1.0

The first version.

- **The agent:** reads, searches, edits, patches and runs commands in the folder of a project, and cannot leave it. Every file change and command asks first. Plan mode only reads; Build mode changes things. Diff of each step, undo and redo, background commands, sub-agents, `/commands` and `/init`.
- **Models:** Ollama, LM Studio and llama.cpp on your computer are detected; OpenRouter, OpenAI, Groq, Mistral, DeepSeek and any OpenAI-compatible server are in the list. The formats of Anthropic and Gemini are written and tested against simulators, not yet with real keys. Small models get a real context in Ollama, a low temperature, a stop to loops and a retry when they answer nothing.
- **Total.js knowledge:** recipes, the pages of Forge for each request, the conventions as a skill, a check of what is written (syntax, style, invented functions) and a correction of the code in the answers. An evaluation with 29 cases measures it with any model.
- **Interface:** projects and sessions, streaming chat, copy button on code boxes, attachments, split diff, git state, a terminal with an interactive shell (macOS and Linux), scheduled prompts, sessions in git worktrees, light and dark theme, English, Spanish and Slovak.
- **Protocols:** a client of MCP tools and prompts, and Totem as an MCP server (off by default).
- **Security:** secret files ask first, keys and the token never reach the model, a server that listens beyond this computer refuses to start without a token, strict cookie, same-origin checks and security headers.
- **Delivery:** the `totem` command, a Docker image that runs as a user that is not root, and the package `totaljs-totem` (the data goes to a folder of your user when it is installed from npm).
