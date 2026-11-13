# Help

The usual problems, and what to do. If yours is not here, [open an issue](https://github.com/totaljs-es/totem/issues).

## Installing and starting

| Problem | What to do |
|---|---|
| `totem` says it could not start | It says why. The port in use: use another one (`totem 4524`). No permission to write the data: choose a folder of yours (`totem --data <folder>`). A broken installation: install it again. The whole output of the server is in `totem.log` in the data folder |
| `totem` says it is already running | It opens the one that runs. `totem status` says where it listens and `totem stop` stops it |
| I started it with `totem serve` and the terminal is busy | That command keeps Totem in the terminal until Ctrl+C. Use `totem` to get the terminal back |
| Where is my data? | `totem config` prints the folder |
| The container does not start | It needs an access token: mount a file at `/run/secrets/totem_token`, or set `token` in `config` |
| Docker cannot see my folder (Colima, Docker Desktop) | Share the folder with the virtual machine: your home folder, not `/tmp` |

## Models

| Problem | What to do |
|---|---|
| There is no model to choose | **Settings**, then add a provider, or *Look for servers on this computer* with Ollama or LM Studio running |
| A small model seems to ignore the instructions | Check `ollamactx` in `config`: Ollama must get a real context (Totem asks for 16384 by default) |
| A model repeats itself until it stops | Totem asks Ollama to penalize repeating and to stop one answer after a limit (`ollamarepeat`, `ollamapredict`, and a lower `ollamapredictsmall` for models up to 4B) |
| The model answers with code in spaces and not tabs | Totem checks the code of the answer and asks the model to correct it once. A very small model does not always manage |
| A model does not call tools | It does not support them: Totem sends it the request without tools. Choose another model for editing |

## Total.js

| Problem | What to do |
|---|---|
| The agent mentions jComponent in server code | Totem's recipes and its reminder keep the interface out of server questions, but a small model may slip. Tell it; or use a bigger one |
| LiteLLM in front of Ollama: the model answers with JSON, or forgets what I asked | In the config of LiteLLM write the model as `ollama_chat/<model>` (not `ollama/`). Totem sends the window (`num_ctx`) by itself |
| I do not want the recipes or the code check | `recipes : false` and `selfcheck : false` in `config` |
| I want the documentation of Forge too | `forge : true` in `config` (or in Settings): its pages are ranked together with the library of Totem. `forgemcp : true` adds its MCP tools (it asks to start), and `forgedocs : false` leaves only the MCP server |
| I do not want the pages of the knowledge repository | `library : false` |

## The interface

| Problem | What to do |
|---|---|
| "The terminal could not start" | The Shell needs Python 3 (macOS and Linux). It is in the Docker image |
| A worktree could not be created | The project needs git with at least one commit |
| Scheduled prompts do nothing | They run unattended: in Plan mode they only read, and anything that would ask is refused. Choose Build and auto-accept to let them edit |
| A scheduled prompt does not start | A schedule never starts while its previous run is still going. Check the model is available and the folder exists |
| The session says "The worktree of this session was discarded" | Start a new session: a discarded worktree cannot run |

## Security

| Problem | What to do |
|---|---|
| Can I open Totem to my network? | Yes, with a token: `$ip` in `config` and `token`. Without a token it refuses to start. See [security](security.md) |
| Does the model see my keys? | No. Keys and the token are scrubbed from everything the model sees, and `.env` files ask first |
