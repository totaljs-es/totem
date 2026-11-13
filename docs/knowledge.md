# Knowledge of Total.js

A small model does not know Total.js 5: it has seen Express a thousand times and `NEWACTION` never. Totem does not depend on what the model remembers. For a request in a Total.js project it puts the knowledge in front of the model, checks what comes out, and lets the model fix it.

A project counts as Total.js when its `package.json` depends on `total5`, or when the folder is new (`totaljs : always` and `never` decide for every project).

## What the model gets

| Piece | Where | What it is |
|---|---|---|
| **Primer** | `private/prompts/totaljs.txt`, in the system prompt | The rules: server code never needs the interface, ES5 and tabs, the shape of a project, one action with its route, and when to use the tools |
| **Recipes** | `private/recipes/*.md`, after the primer | Up to two short answers for the task of the request (routes, actions, NoSQL, config, RESTBuilder, auth, CRON, WebSockets, views, ids, modules, jComponent, plugins...) |
| **Library** | The library of Totem (`library`, on by default): the Total.js knowledge repository, with the conventions, questions and answers, tested applications and the catalogue of components and icons, from its `llms.txt`, after the recipes | The page that best matches the request (two by default; a model up to 4B uses one focused recipe for UI, application starters and native configuration, and at most one page for other tasks). The search runs in Totem over the index, so the prompt never leaves the computer, there is no server to start and nothing to allow. The ranking also uses `knowledge.json` of the library (the API names and the words of the headings of each page, downloaded once a day; without it the pages are ranked by title, address and description). A page longer than `forgechars` is not cut at the start: its first lines stay, then the blocks with the words of the request, and a block of code is never cut in half. It is read live with a GET, so a corrected page reaches Totem without a new version and without training. The questions in other languages are left out: their code is the same as the English ones. `libraryurl` says where it is |
| **Forge** (optional) | The documents of [Forge](https://forge.totaljs.es) (`forge : true`; off by default) | One more source for who wants it, for example with other models: its pages are ranked together with the pages of the library, and with the same score the page of the library is read. `node scripts/docs-eval.js` measures the choice of the page without a model (25 requests, expected page first or in the first three). `forgemcp : true` adds its MCP server, which asks to start |
| **Reminder** | The end of the prompt of the user, never stored; not for a greeting, a command or the request to correct code | The style (tabs, ES5, `Total.Fs`, `Total.Os`), to look in the documentation and ask the user when nothing is found, not to invent functions, to answer in the language of the user, and to show one final solution in fenced code blocks with a language and file path (or to make the files, when the request is to make something). It mentions jComponent only when the request is about an interface: a reminder that always says "jComponent" makes a model put jComponent in a route |
| **Skill** | `private/skills/totaljs-conventions` | The conventions and where to look things up, loaded on demand |

The conversation shows what was used ("Knowledge used": the recipes and the pages of the library).

## What happens with the answer

1. **Files** that the agent writes or edits go through the checker of the conventions (`private/conventions/check.js`, a copy of the one in the [conventions repository](https://github.com/totaljs-es/conventions)) and, when the project has them, through its formatter and its own checks (`diagnostics`). The findings go back to the model in the result of the tool, in the same step.
2. **The code in an answer** (a fenced `js` or `html` block) is checked the same way, plus a test of the syntax and one of the functions in capital letters: one that Total.js 5 does not have (`VALIDATE_EMAIL()`) is an invention. Answer text is held until the checks finish; tool progress and reasoning still stream. Raw complete HTML is wrapped in a code fence and ordinary space indentation is converted to tabs without another model request (literal-sensitive blocks are left alone). Syntax inside HTML script blocks and known invalid jComponent APIs are checked too. If something remains wrong the model is asked once to correct it, without tools. Only its final revision is published and stored, with a short review note; the draft and correction request are not chat messages. The revision is checked again. Remaining findings or an output limit produce a review notice and disable automatic saving. The explicit Save offer remains available for nonblocking warnings, while errors and incomplete output block it. `selfcheck : false` turns it off.
3. **A model of up to 4 billion parameters** (qwen2.5:1.5b, llama3.2:3b) is helped where it fails: the code of its older answers is left out of the history (it copies it for any prompt), its answers have a lower limit (`ollamapredictsmall`), the request to correct its code does not carry the reminder of the style (a model of 1.5B answered the complaint and the reminder with themselves; `selfchecksmall : false` does not ask it at all), a request to show or explain with a recipe in front of it goes without tools (it goes to read files that do not exist), and when it was asked to make files and answered with the code, the blocks with a path (a comment, the file info after the fence language, or a preceding filename on a creation request) that do not exist yet are written with the write tool, with its permission and its diff. In the chat every code block of an answer without blocking errors has a *Save this code to your project…* button. It asks for a path inside the project, using the comment path as a suggestion when present; copying and saving use the original source, preserving tabs rather than the syntax-highlighted DOM (a file that exists is replaced only if the user confirms, and the old content stays in Undo).
4. **An empty answer** (a small model tries a tool call with a broken JSON and the server swallows its text) is asked again without tools, once.

## Application starters

For an explicit Build request to create an application in a Total.js folder without package.json, models up to 4B start with the same native scaffold as `/new`. Its writes use normal permission checks and preserve existing files. An explicit first GET path and literal text response can be put into the controller template. The model receives the actual write results and continues with remaining requirements. This protects the framework boot sequence; it does not verify arbitrary application features.

## Commands that do not need the model

`/new <name>` writes the files of a minimal Total.js 5 application (package.json with `total5`, index.js, config and a first route) and never replaces a file that exists. `/init` with a model of up to 4 billion parameters writes `AGENTS.md` from the files of the project (folders, scripts, dependencies and the conventions of Total.js) instead of asking the model, which cannot write it; with a bigger model the command is a prompt as before, with the facts of the project in it. An `AGENTS.md` that exists is never replaced.

## Recipes

Recipes are selected anew for every request and remain available on follow-ups. A complete HTML request prioritizes the complete jComponent page recipe; HTML and browser components search the jComponent documentation rather than server-component pages. Clear Build requests create the files with the write tool; broad requests no longer stop by asking which file to write first. A small model can fall back to up to 24 named code blocks, each checked and approved through the normal write tool. Their write results and diagnostics return to the model before the run finishes.

A recipe is a Markdown file with a header:

```
---
title: A route that answers with text, JSON or a view
keywords: route, routes, ruta, endpoint, get, post, json, answer ...
strong: route, routes, ruta, rutas, controller, controllers
---
Text and code that follow the conventions.
```

A word in `strong` counts three, a word in `keywords` counts one, and a recipe needs two points: the word of the topic itself is enough, a loose word is not (so "hello how are you" gets nothing). Spanish words go in the same lists. Write the code as the conventions say: tabs, ES5, `Collection|verb`, `Total.Fs`, `CONF`, `$.callback`. The test of recipes checks the code of every recipe against those rules. `recipes : false` turns them off and `reciperesults` changes how many are used.

## Measuring it

```bash
node scripts/knowledge-eval.js --model ollama:qwen2.5:1.5b             # every case once
node scripts/knowledge-eval.js --model <id> --runs 3 --out result.json  # three times each: a small model does not answer the same way twice
node scripts/knowledge-eval.js --model <id> --filter route              # cases whose id or topic contains "route"
node scripts/knowledge-eval.js --model <id> --no-forge                  # without the pages of Forge
node scripts/knowledge-eval.js --rejudge result.json --lenient          # the saved answers again, without style, without the model
node scripts/knowledge-eval.js --list
```

The cases are in `tests/knowledge/cases.json`. Each is a prompt, asked in Plan mode in a new session of a temporary Total.js project:

```json
{ "id": "route-plain", "topic": "routes", "code": "js",
  "prompt": "How do I define a route in Total.js 5 that answers GET /hello with the text Hello?",
  "must": ["ROUTE\\(\\s*['\"]GET /hello", "\\$\\.(plain|text)\\("],
  "mustnot": ["express"],
  "mustnotcode": ["[jJ][cC]omponent", "COMPONENT\\("] }
```

A case passes when every `must` expression matches the answer, no `mustnot` matches anywhere, no `mustnotcode` matches inside a code block, and the code passes the checks above: syntax, style, no invented function. `code` says that the answer must show a code block of that language. By default Forge is allowed to start, as a person would allow it; with `--no-forge` the model has the primer and the recipes only. `--lenient` ignores style.

The script starts a temporary server (without the watcher) that uses the providers of this installation, and removes the sessions and the project it created. Add a case when you find an answer that is wrong; add a recipe when a case keeps failing.

## Results

`qwen2.5:1.5b` (986 MB) on a Mac, Forge on, the 29 cases of the set, with the style of the code counting (tabs, ES5...).

How the score went up while the knowledge was built (one run per case, so read it as a direction):

| Step | Score |
|---|---|
| The primer and the skill only | 3/29 |
| Reminder without jComponent, new primer, retry of empty answers | 12/29 |
| More recipes, Forge with the pipe in action names, fairer cases | 16/29 |
| No code examples in the primer (the recipes bring them), no "answer with the code" for greetings and commands (0.1.4) | 18/29 |
| Forge documents without MCP, recipes for system information and for starting an application, one page when there is a recipe, the correction of the code with a clean request (0.1.5) | 20/29 |

The 0.1.4 row is one run: routes 4/4, actions 2/3, storage 2/2, jComponent 3/5, structure 2/4, style 0/3, auth 0/1, views 0/1. The change came from a bug seen by using Totem: with the two code examples in the primer and a reminder that always asked for code, the model answered "Hola" with the example of an action. Greetings now get a greeting, and the score did not go down.

Routes, actions, storage and jComponent pass without counting style. What still fails is the model: a template literal where ES5 is asked, `require` for a setting, a syntax error in a longer example, a function that does not exist.

**Does the correction of the code in the answer help?** Three runs of every case, with it off and on (`selfcheck`):

| | Score | Time per answer | Runs that hit the limit of 240 s |
|---|---|---|---|
| `selfcheck : false` | 39/87 (45%) | 18 s | 0 |
| `selfcheck : true` | 42/87 (48%) | 30 s | 3 |

Eight cases got better, four worse and seventeen did not change: with a model this small the difference is within the noise (a small model does not answer the same way twice), and the correction costs about twelve seconds per answer that has code. The model often repeats the complaint instead of fixing the code, or fixes one thing and breaks another. It is left on because it catches what a person would not accept (a function that does not exist, a syntax error) and a bigger model should use it better, but that has not been measured: the only model on the computer where this was made is this one. If your model is small and slow, `selfcheck : false` is a fair choice.
