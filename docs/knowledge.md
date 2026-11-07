# Knowledge of Total.js

A small model does not know Total.js 5: it has seen Express a thousand times and `NEWACTION` never. Totem does not depend on what the model remembers. For a request in a Total.js project it puts the knowledge in front of the model, checks what comes out, and lets the model fix it.

A project counts as Total.js when its `package.json` depends on `total5`, or when the folder is new (`totaljs : always` and `never` decide for every project).

## What the model gets

| Piece | Where | What it is |
|---|---|---|
| **Primer** | `private/prompts/totaljs.txt`, in the system prompt | The rules: server code never needs the interface, ES5 and tabs, the shape of a project, one action with its route, and when to use the tools |
| **Recipes** | `private/recipes/*.md`, after the primer | Up to two short answers for the task of the request (routes, actions, NoSQL, config, RESTBuilder, auth, CRON, WebSockets, views, ids, modules, jComponent, plugins...) |
| **Forge** | The MCP server of [Forge](https://forge.totaljs.es), after the recipes | The two pages of the documentation that best match the request. Totem asks before it starts the connection. The names of actions are written with the pipe of the conventions before the model reads them |
| **Reminder** | The end of the prompt of the user, never stored | The style (tabs, ES5, `Total.Fs`), not to invent functions, and to answer with the code in plain text. It mentions jComponent only when the request is about an interface: a reminder that always says "jComponent" makes a model put jComponent in a route |
| **Skill** | `private/skills/totaljs-conventions` | The conventions and where to look things up, loaded on demand |

The conversation shows what was used ("Knowledge used": the recipes and the pages of Forge).

## What happens with the answer

1. **Files** that the agent writes or edits go through the checker of the conventions (`private/conventions/check.js`, a copy of the one in the [conventions repository](https://github.com/totaljs-es/conventions)) and, when the project has them, through its formatter and its own checks (`diagnostics`). The findings go back to the model in the result of the tool, in the same step.
2. **The code in an answer** (a fenced `js` or `html` block) is checked the same way, plus a test of the syntax and one of the functions in capital letters: one that Total.js 5 does not have (`VALIDATE_EMAIL()`) is an invention. If something is wrong the model is asked, once, to answer again with the corrected code. The conversation shows a note with the rules. `selfcheck : false` turns it off.
3. **An empty answer** (a small model tries a tool call with a broken JSON and the server swallows its text) is asked again without tools, once.

## Recipes

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

Routes, actions, storage and jComponent pass without counting style. What still fails is the model: a template literal where ES5 is asked, `require` for a setting, a syntax error in a longer example, a function that does not exist.

**Does the correction of the code in the answer help?** Three runs of every case, with it off and on (`selfcheck`):

| | Score | Time per answer | Runs that hit the limit of 240 s |
|---|---|---|---|
| `selfcheck : false` | 39/87 (45%) | 18 s | 0 |
| `selfcheck : true` | 42/87 (48%) | 30 s | 3 |

Eight cases got better, four worse and seventeen did not change: with a model this small the difference is within the noise (a small model does not answer the same way twice), and the correction costs about twelve seconds per answer that has code. The model often repeats the complaint instead of fixing the code, or fixes one thing and breaks another. It is left on because it catches what a person would not accept (a function that does not exist, a syntax error) and a bigger model should use it better, but that has not been measured: the only model on the computer where this was made is this one. If your model is small and slow, `selfcheck : false` is a fair choice.
