# Total.js Totem: design

Totem is an AI coding environment written as a Total.js 5 application. You open a project, talk to an agent that reads the code, edits files and runs commands, and review what changed. The same application runs from a terminal, in a Docker container and inside a native window.

These pages describe what Totem does and why. They are the contract for the code: when the code and a page disagree, one of them is a bug. The README of the repository is the way in; the roadmap says what is built and what is next.

| Page | What it answers |
|---|---|
| [Vision](vision.md) | What Totem is, who it is for, what it will not do |
| [Architecture](architecture.md) | Folders, processes, the request path, how Total.js features are used |
| [Agent loop and tools](agent-loop.md) | How a prompt becomes edits; tools as actions |
| [Data model](data-model.md) | Projects, sessions, messages, parts, snapshots and where they live |
| [Protocol](protocol.md) | REST endpoints and the WebSocket events the interface speaks |
| [Permissions and security](security.md) | What the agent may do, what it asks for, how the server is protected |
| [Interface](interface.md) | Screens and the jComponent components they use |
| [Capabilities](capabilities.md) | The list of features, each with its phase |
| [Knowledge](knowledge.md) | How the agent knows Total.js (recipes, its library, checks) and how to measure it with any model |
| [Delivery](delivery.md) | Command line, Docker image and native windows |
| [Roadmap](roadmap.md) | Phases, each with the condition that closes it |
| [Decisions](decisions.md) | Decisions taken and the ones still open |

## How to read the status of a statement

- **Verified** statements about Total.js name the file of the framework that supports them.
- A statement that says *done* is built and has a test; one that says *simulators only* has not been tried with the real service.
- Open questions live only in [decisions](decisions.md).
