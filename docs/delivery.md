# Delivery

One application, three ways to run it. Nothing is rewritten between them.

## Command line

```bash
npm install
node index.js 8000
```

`bin/totem.js` (`bin` of `package.json`, Node.js 22 or newer) wraps it for users:

| Command | Does |
|---|---|
| `totem` | Starts the server on port 8000 and opens the browser |
| `totem serve [port]` | Starts only the server |
| `totem run "prompt" [--project path] [--model name] [--url server] [--token t] [--auto-accept] [--yes]` | Headless: creates a session, subscribes to its events, sends the prompt, prints the answer on stdout and tool calls on stderr, exits 0 when the run ends idle and 1 otherwise. Without `--url` it starts a temporary local server. Permission questions are rejected unless `--yes` (allow once) or `--auto-accept` (file edits) is given |
| `totem config` | Prints the path of the config and data folders |

Today the data folder is `databases/` inside the application folder (`totem config` prints it). Moving it to a per-user folder is an open decision. A project can carry `.totem/` for skills.

## Docker

The image is the application and nothing else (`Dockerfile`, `.dockerignore`):

- Base: the maintained Node.js LTS on Alpine, pinned by digest (Dependabot opens a pull request with the new digest when Node.js publishes a release), plus `python3` for the interactive shell and `git` for the Git panel.
- Projects are bind-mounted (`/workspace`), data is a volume (`/data`, linked to `databases/`), the access token is a Docker secret (`/run/secrets/totem_token`, read when `token` in the config is empty).
- Runs as the non-root user `node`, in release mode (`--release`: without the watcher). The `config` of the image is the one of the application with `$ip : 0.0.0.0` and `tokenfile` set at build time. The server refuses to start (exit code 1) when it listens beyond this computer without an access token: that rule is in the application, so it also holds outside Docker.
- Because commands run inside the container, this is also the isolated mode recommended for untrusted models ([security](security.md)).
- `docs/docker-compose.yml` is the example for the common case. The registry and the tags per version belong to the release workflow (not built yet).

```bash
docker build -t totem .
echo "a-long-random-token" > token.txt
docker run --rm -p 127.0.0.1:8000:8000 -v "$PWD/token.txt:/run/secrets/totem_token:ro" -v "$PWD:/workspace/project" -v totem-data:/data totem
```

`node scripts/docker-smoke.js [image] [folder]` is the smoke test: no token means no start; with a token it serves, refuses a request without it, opens the mounted project, lists its files and runs a command in the shell as a user that is not root. CI runs it (`.github/workflows/test.yml`) next to the unit tests. On Colima and Docker Desktop the folder for the temporary files must be shared with the virtual machine (the home folder, not `/tmp`).

## Native windows

A native app is a thin shell: it starts the same server on a random local port with a one-time token, loads `http://127.0.0.1:<port>` in a web view, and stops the server when the window closes. It adds only what a web page cannot do: a folder chooser, menu bar, notifications, file association, auto-start of the server, and update checks against the project's own release feed.

Shell technology is an open decision ([decisions](decisions.md)). Whatever it is, it must keep these properties:

- The server inside is the unmodified application (bundled Node.js runtime).
- macOS builds are signed and notarized; Windows and Linux artifacts are checksummed.
- The release workflow builds from a tag, per operating system and architecture, and publishes checksums with the installers.

## Releases

- One version number for the application, the image and the native builds: `package.json`, the `config` file and a heading in `CHANGELOG.md` say the same.
- A release published on GitHub with the tag `v<version>` starts `.github/workflows/release.yml`; nothing publishes from a branch.
- The workflow checks the release (`node scripts/release-check.js v<version>`: version, tag, changelog, exact `total5`, and a README that tells how to install it), runs the unit tests and the smoke test of the image, and then publishes two things:
  - **The package `totaljs-totem` on npm**, with trusted publishing and the provenance of the package: no secret. The package ships the bundle of components (`npm run bundle`), so the installed application does not download anything or write in its own folder. Installed from npm, the data goes to a folder of the user (`~/Library/Application Support/Totem`, `~/.local/share/totem`, `%APPDATA%\Totem`; `totem config` prints it, `--data <folder>` changes it).
  - **The image `ghcr.io/totaljs-es/totem`** for `linux/amd64` and `linux/arm64`, tagged `latest`, `<version>` and `<major>.<minor>`. It uses the `GITHUB_TOKEN` of the repository.
- Release notes list user-visible changes only.

### Releasing

1. Change the version in `package.json` and `config`, add its heading to `CHANGELOG.md`, update the README (how to install it, the Status) and wait for the continuous integration to pass.
2. **The first time only: publish the first version by hand.** A trusted publisher is configured on a package that exists, so `totaljs-totem` 0.1.0 is published once from your computer: `npm run release-check`, then `npm publish --access public` (it asks for your one time password; `prepack` makes the bundle). Then, in the settings of the package on npmjs.com, add a trusted publisher: GitHub Actions, organization `totaljs-es`, repository `totem`, workflow `release.yml`, no environment.
3. Create a release on GitHub with the tag `v<version>`. The workflow skips the version that npm already has (the first one), and publishes the image.
4. **The first image only:** the package `totem` appears in the packages of the organization as private. Make it public in its settings (*Change visibility*), or `docker pull` asks for a login.
5. From then on, every release publishes both without anything by hand.
