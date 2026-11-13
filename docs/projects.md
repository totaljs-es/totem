# A whole application in small tasks

A model of a few billion parameters writes one file well and loses its way in thirty steps. So Totem does not ask it for thirty steps. It asks for a short plan, makes the tasks itself, and gives the model one file at a time with everything that file needs.

```
/project <what the application must do>     the plan: a card with the plugins and their fields
/build                                      the tasks of the plan, one by one
```

## The card

The plan of an application is a card, short enough to read in a minute and to correct by hand:

```
APP: shop

PLUGIN: products
TITLE: Products
ICON: ti ti-grid
FIELDS: *name:String, price:Number, isactive:Boolean

PLUGIN: customers
TITLE: Customers
ICON: ti ti-building
FIELDS: *name:String, email:Email, phone:Phone
```

A plugin is one kind of thing that the application keeps, with its list and its form. The fields are written as the input of an action writes them: `name:Type`, a `*` before the name of a required one. The types are `String`, `Number`, `Boolean`, `Date`, `Email`, `Phone` and `URL`. The id and the dates of a row are not fields: every row has them.

`/project` with a request asks the model to fill the card. `/project` followed by a card keeps that card as the plan and asks no model, so you can write it yourself, correct the one of the model, or let a larger model write it. `/project` alone shows the plan.

Totem checks the card (a plugin without fields, an unknown type, the same plugin twice) and says what is missing. The plan is saved in the project: `.totem/project.md` for people, with the card, the names and the list of tasks, and `.totem/project.json` for Totem.

## The tasks

Totem makes the tasks from the card. The model does not decide them:

| Task | Who writes it |
|---|---|
| The shell: `package.json`, the official start script, `config`, the menu and the layout | Totem. They are the files of an application that was checked in a browser |
| `plugins/<name>/index.js`: the menu entry and the routes | Totem. It is the same for every plugin but for the names |
| `plugins/<name>/schemas/<name>.js`: the actions | The model |
| `plugins/<name>/public/index.html`: the screen | The model |
| `plugins/<name>/public/form.html`: the form | The model |

`/build` walks the tasks that are not done. Each task of the model is **a run with no history**: it gets only

1. the file to write,
2. the card of its plugin,
3. the names that the other files use (the actions, the endpoints of the API, the path of the form). They come from the card, not from what the model remembers, so every file of a plugin agrees with the others,
4. the same file of a plugin that works, as the example to follow.

That is a short prompt, which matters on a computer without a GPU, where reading the prompt is the slow part.

## The checks

After each task Totem checks the file before it goes on: the actions that the routes call exist, the input has every field of the card with its type, the file is valid JavaScript, the screen and the form use the endpoints of their plugin and none of the example. One line is not asked again: the input of the action that saves is the card word for word (`id:UID` and the fields), so when the model misplaces a star Totem sets that line from the card, as it does with the names. The same for the names of the example plugin that a model leaves in a screen or a form where the endpoints and the path of the form go: they are the card's, and Totem puts them. The texts and the fields are the model's, and they are checked. A file that fails is asked once more with the problem in a sentence. If it fails again the build stops there and says why; the next `/build` starts at that task.

A file that is already there is not written over: when it passes the check its task is done, and when it does not, you decide. A build that was stopped goes on where it was. A plugin added to the card adds its tasks and keeps the ones that are done.

The files of a build are not asked one by one: you saw the plan and sent `/build`. They are written with the same tool as any other change, so each one has its diff and its undo, and Plan mode still writes nothing.

## Another agent does the thinking, Totem does the writing

An agent with a large model, such as Claude Code or Codex, can use Totem and its local model as its hands:

1. The large model reads the request and writes the card. That is a couple of hundred tokens.
2. It gives the card to Totem and tells it to build.
3. Totem writes the files with the model of your computer, which costs nothing, and checks each one.
4. The large model gets a few lines back and reads a file only when it wants to review it.

The tokens that cost money go to the plan and to the review. The files, which are most of the tokens of an application, are written on your computer.

To let an agent use it, give it one address: **`http://127.0.0.1:8000/agent/`**. It answers with a page of plain text of about 240 words that says all of this: the card, the commands and the routes, and the models that this Totem has.

**With a shell on the same computer**, the command line. The answer is a few lines:

```
totem project "APP: shop

PLUGIN: products
FIELDS: *name:String, price:Number" --project ./shop

shop: plan saved, 1 plugin, 5 tasks. Next: build

totem build --project ./shop

shop: 5 of 5 tasks done
run it: npm install && node index.js 8000
```

`totem plan` says what is done. A task that fails is one more line, with the file and the reason. The three commands use the server that `totem` started, the one of `--url`, or a temporary one; `--model` chooses the model and `--wait` how many seconds to wait.

**Without a shell**, the same over HTTP, with a JSON body and a plain text answer (and the header `x-token` when the server has an access token):

| Route | Body | Answer |
|---|---|---|
| `GET /agent/` | | How to use it |
| `POST /agent/project/` | `{ "path", "text", "model", "wait" }` | The plan was saved, or what is wrong with the card. `text` is the card, or a request for the model to fill it |
| `POST /agent/build/` | `{ "path", "model", "wait" }` | What is done when the build ends, or `(building)` when `wait` seconds are over |
| `GET /agent/status/?path=` | | What is done |

**MCP** is the third way, for a client that has neither (a chat application): `$mcp : true` in `config` (see [security](security.md)), then the prompts `/project` and `/build` through `Sessions_prompt`, and `Sessions_plan` for the tasks with their status. It costs the other agent more tokens than the two above: the definitions of the tools stay in its context, and the answers are whole messages.

## What it is and what it is not

It makes applications of the shape that most Total.js applications have: several plugins, each one with its data, its list and its form. It does not design an architecture of its own, and three things are not in the card yet: a field that points to a row of another plugin (the owner of a pet), a sign-in with users, and a screen that is not a list with a form. Those are written after the build, in the conversation, on an application that already runs.
