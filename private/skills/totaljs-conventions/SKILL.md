---
name: totaljs-conventions
description: How Total.js 5 applications are written (ES5, pipe-separated action names, schemas, controllers, definitions, modules, jComponent 20 plugins) and where to look things up in Forge. Load it before you write or change Total.js code.
---

# Total.js 5 conventions

Copy the pattern of the nearest existing file of the project: a new file looks like its neighbours. Read the route, the action and the screen of a feature together before you write a new one.

## Server

- Actions are `NEWACTION` in `actions/` (in an application that already has `schemas/`, there: both folders are loaded in the same way); routes are `ROUTE()` in `controllers/` (or the plugin `index.js`); shared helpers go in `FUNC`, shared state in `MAIN`; loaded modules are used through `MODS`.
- Action names use a pipe: `Tickets|list`, `Reports|Categories|list`. Never `/` or `\`. When a name changes, change its registration, its route target and its callers together.
- Declare `input`, `params` or `query` once. Check ownership, permissions and business rules inside the action. Answer once: `$.callback(data)`, `$.success(id)`, `$.invalid(404)`, `$.invalid('@(Text)')`.
- ES5 in new code: `var`, `function`, classic loops, `'{0}'.format()`. Tabs, semicolons, short names (`id`, `name`, `dtcreated`).
- Use the Total.js prototypes (`findItem`, `parseJSON`, `slug`...) before other functions. Do not `require()` Node.js modules in application code: use `Total.Fs`, `Total.Path`, `Total.Crypto`, `Total.Os` (case-sensitive).
- Storage as the project has it: `DATA` for SQL, `NOSQL`, `FILESTORAGE`. Ids are `UID()`, dates are `NOW`. Outgoing HTTP is `RESTBuilder`.
- Every text for people is `@(English text)`.

## Interface

- Plugins: `plugins/<name>/index.js` plus `public/index.html` with `<ui-plugin class="CLASS">` and `PLUGIN(function(exports) { ... })`. Call the server with `exports.tapi('name ERROR', data, callback)`. Buttons use the class `exec` with `data-exec="?/function"`.
- Use an existing jComponent 20 component; load catalogue components with `COMPONENTATOR()`. Scope CSS with `CLASS`.

## After you write

Totem checks the files that you write in a Total.js project and appends what it finds to the result of the tool. Fix every `error` and `warn` that belongs to your change.

## Look things up in Forge

Forge (https://forge.totaljs.es) has the documentation of Total.js 5 and jComponent 20 with versions and execution evidence. When the tools `forge__Forge_search`, `forge__Forge_page` and `forge__Forge_verify_api` are available:

The arguments of these tools go inside `input`, for example `{ "input": { "query": "NEWACTION input" } }`.

1. `forge__Forge_search` finds the pages about a topic; `forge__Forge_page` returns the Markdown of one page.
2. `forge__Forge_verify_api` checks the names that your code uses against the documented globals of Total.js 5: run it on code that you wrote before you answer.

Without them, use the fetch tool on these pages:

- https://forge.totaljs.es/en/docs/totaljs-agent-conventions.md
- https://forge.totaljs.es/en/docs/code-style.md
- https://forge.totaljs.es/en/docs/common-mistakes.md
- https://forge.totaljs.es/en/docs/project-structure.md
- https://raw.githubusercontent.com/totaljs-es/knowledge/main/llms.txt (the library of Totem: the conventions, short answers, questions, tested applications, the catalogue of the components and the names of the icons)
- https://forge.totaljs.es/llms.txt (the documentation of Forge)
- https://raw.githubusercontent.com/totaljs-es/conventions/main/llms-full.txt (all the conventions in one file)

Do not use Total.js 4 APIs. If a page and the source disagree, the source is right.
