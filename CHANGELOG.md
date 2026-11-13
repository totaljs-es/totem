# Changelog

## Unreleased

- Fixed: the conversation went up while the model answered and the answer had to be looked for below. The chat stays at its end whenever the conversation grows (a new part, a button under an answer, highlighted code), only a scroll that the reader makes stops it from following, and a redraw leaves the reader where they were.
- The knowledge of Total.js is the library of Totem alone by default: its pages are the ones that go in front of the model, and the documentation of Forge is an option that is off (`forge : true` in `config` or in Settings ranks its pages together with the library, for example with other models). Nothing asks to start Forge any more. The instructions of the model, the skill of the conventions and the documentation say so.

## 0.1.8

- Fixed: a model that refused the images of a prompt was forgotten as blind when the list of models was made again (a provider saved, a new model found), and the next prompt sent it the images again.
- A project card accepts the usual other names of a field type (`int`, `text`, `bool`, `datetime`...) instead of refusing the whole plan.
- A task of a project writes one file and ends: the model gets only the tool that writes, every call but the one that writes the file of the task is refused, and the run ends when that file is written. A model that went on by itself after its file wrote over the files of the other tasks and repeated itself until the step limit; now it cannot, and each task is one call to the model.
- The actions of an application go in `actions/`: the recipes, the instructions of the model, the skill and the files of a project (`plugins/<name>/actions/<name>.js`) say so. An application that already has `schemas/` keeps its actions there; Total.js 5 loads both folders in the same way.
- A model of a local Ollama whose name was typed by hand in the form of the provider gets what the server says of it (tools, thinking, context), as a detected one does. Without that the thinking of a small model was not switched off, and its whole answer stayed in the thinking. The plan of a project is read from the thinking when the answer is there.
- In a build, the input of the action that saves is set from the card when the model misplaces the star of a required field (a required `id` refused every new row and stopped the build after two tries): that line is the card word for word, as the names of the actions are. The names of the example plugin that a model leaves in a screen or a form (the endpoints, the path of the form) are changed to the ones of the card too.
- The search of the pages understands more Spanish words of the interface (chart, bar, calendar, dropdown, window, tab, map, upload, sort, drag, confirm...), so a request in Spanish for a component finds it in the catalogue: "un gráfico de barras" finds the bar chart. The measure of the choice among the pages of Forge went from 24 to 25 of 25 first.
- Totem, the model trained for this application, is shown with its own icon in the model selector, whatever serves it (Ollama, llama.cpp, vLLM, a remote server): the other models keep the icon of their provider. It is recognized by what the model says inside (the identity that it was exported with, which Ollama reports), so it is Totem under any name, and by its name (`totem:4b`, `totem-v4:4b`) where the server says nothing.
- The routes for another agent say why when the model itself fails (it is not installed, it does not answer) instead of a bare "not accepted".
- A whole application in small tasks. `/project <request>` asks the model for a short card (the plugins of the application and the fields of each one), or keeps the card that comes written; `/build` makes the tasks from the card and walks them one by one. The shell of the application and the server part of each plugin are fixed files that Totem writes; the actions, the screen and the form of each plugin are written by the model, each in a run with no history that gets the card of its plugin, the names that the other files use and the same file of a plugin that works. Each file is checked before the next (the actions that the routes call, the input with every field and its type, valid JavaScript, the endpoints of its plugin), asked once more with the problem when it fails, and the build stops there when it fails twice. The plan is kept in `.totem/project.md` and `.totem/project.json`, so a build goes on where it stopped. See `docs/projects.md`.
- For another agent, in as few tokens as possible: the commands `totem project "card or request"`, `totem build` and `totem plan`, and the routes `POST /agent/project/`, `POST /agent/build/` and `GET /agent/status/`, answer in a few lines of plain text (`shop: 9 of 9 tasks done`, or the task that failed and why). `GET /agent/` is a page of plain text of about 240 words that tells an agent how to use them: it is the one address to give it. The card checks the icon of each plugin against the names of Total Icons (`private/project/icons.txt`) and uses the folder for one that does not exist.
- The MCP server has the tool `Sessions_plan` (the card and the tasks of a project with their status), so that another agent can write the plan, send `/project` and `/build` as prompts, and follow the build.
- The instructions of the model say where the server ends and the browser begins: Total.js 5 sends models (JSON or the model of a view) and jComponent 20 is in charge of the browser. They also say what the two files of the library already have (jQuery, Tangular, the grid of Bootstrap 3, Total Icons, the CSS variables), that the buttons, forms and modals of Bootstrap are not there, and that a component or an icon is used only by a name that was read, not made up. What the recipes and the pages do not have is looked up first in the library of Totem.
- A new application depends on `"total5": ">=0.0.20-2"`: Total.js 5 0.0.20 or later, its beta today and the stable version when it is published, never 0.0.19. The step of `CRON`, `LOGMAIL` with an object and `@{csrf}` in a view are fixed in 0.0.20, so a person starts with the version that works. Totem itself runs on `0.0.20-3`, and the recipe of schedules no longer tells to avoid the step form.
- A local Ollama can add by itself the models installed after it was saved (*Add the models that I install later by themselves* in the form of the provider): they are looked for when Totem starts and every five minutes, with what each one can do. On for an Ollama added from the detected servers, off for the providers that already exist, and never for a remote provider. A model that is gone is not removed.
- *Auto-accept edits* can be the start of a new session: the setting `autoaccept` (off by default) is changed in Settings for all projects or for one. A caller that says yes or no is obeyed, and a command or a download is always asked.
- The library of Totem is read live: the pages of the Total.js knowledge repository (conventions, answers, questions and tested applications) are ranked together with the pages of Forge for a request, from its `llms.txt` with a GET, and with the same score the page of the library is read. A change of a page there reaches Totem in a day, with no new version of Totem and no training. `library : false` turns it off and `libraryurl` says where it is; the questions in other languages are left out because their code is the same.
- The pages of the library are found also by the API names they use and by the words of their headings (`knowledge.json` of the library, made from its pages), and an API name of the request (`CRON`, `UID`, `MAIL`) is enough to choose the page that uses it. Of 25 requests, the library alone had no page for 15; with this and its new page of questions it has one for 24. The choice among the pages of Forge did not change (24 of 25 first, 25 of 25 in the first three).
- A recipe for a component of Total.js Flow (`private/recipes/flow-component.md`): a request for one gets it, in English, Spanish or Slovak, and no longer the recipe of jComponent, which made the model write `COMPONENT()`.
- Fixed: a request to make something in Slovak (`Vytvor…`, `Pridaj…`) was treated as a question, so the model answered with the code and wrote no file.
- Fixed: a comma inside the description of a tool field cut it and added a field that does not exist (`grep`, `bash`, `fetch`, `todo`, `task`).
- Fixed: in the form of a provider, choosing a model in the list of available models left the submit button disabled, and the chosen models showed no check mark.
- Fixed: a tool call that the output limit cut (Ollama answers 500 *invalid tool call arguments*) was retried three times, minutes of silence each; now it is explained once and not retried.
- The write tool leaves out a first line that is the whole path of the file in a comment, as the recipes show it (`// schemas/products.js`).
- A model of up to 4B that can think does not think by default: it spent its short answer on the thinking and looped in it. The reasoning selector of the session still turns it on.
- The `index.js` of a new application is always the official start script of Total.js 5, whole (`private/start/index.js`): in `/new`, in the recipes and in the instructions of the model.
- ES5 is the preference, not a prohibition: the instructions of the model and the check of the conventions accept `const` and `let` at the top of a file when the code needs them, and prefer `var` inside a function.
- The answer limit of a model of up to 4B goes from 1536 to 2560 tokens (`ollamapredictsmall`): half of the answers cut at 1536 were long components that end on their own a little later, not loops.
- The recipes teach what was checked by running it: the records of an application go through `DATA` on the embedded NoSQL database (`DATA.find('nosql/tbl_user')`) so that it can move to PostgreSQL without writing its queries again, and a schedule is written with `ON('service')` or a list of minutes, because the step form of `CRON` (`*/5`) runs every minute in Total.js 5 0.0.19.
- The model selector of the prompt is wider and its list shows the whole name of a model.
- The prompt tells the model that it is in the Totem application and how to check it.
- The choice of the page of Forge for a request is measured without a model: `node scripts/docs-eval.js` ranks 25 requests (English and Spanish) and counts the expected page first or among the first three. With the metadata of `knowledge.json` and more Spanish verbs (send, serve, static, request, decrypt) the hits went from 20 to 24 of 25 first and from 21 to 25 of 25 in the first three. A request about Tangular is no longer sent only to the frontend pages.

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
