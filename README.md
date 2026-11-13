# Totem website

The website of [Total.js Totem](https://github.com/totaljs-es/totem), published at <https://totaljs-es.github.io/totem/>.

This branch (`site`) has nothing in common with `main`: it is only the website, so that the application, its npm package and its Docker image never carry it. The text of the pages is in `main` (`docs/`, `CHANGELOG.md` and `package.json` for the version); this branch has everything else.

| Here | What it is |
|---|---|
| `index.html`, `page.html`, `footer.html` | The templates: the home page, a page of the documentation, the footer of the Spanish Total.js websites |
| `css/corp.css`, `vendor/fonts/`, `site.css`, `site.js` | The look of the Spanish Total.js websites (the corp repository) and what a documentation site adds |
| `img/` | Toto, the logos, the screenshots (`img/shots/`, light and dark) and the card for the social networks (`img/og.jpg`) |
| `scripts/build-site.js` | Builds the website in `dist/` from this branch and from the application |
| `scripts/screenshots.js`, `scripts/og.js` | Take the screenshots from a real Totem and make the social card (need Google Chrome) |
| `.github/workflows/rebuild.yml` | Asks the workflow of `main` to publish the website again when this branch changes |

## Work on it

```bash
git clone https://github.com/totaljs-es/totem.git
cd totem
git worktree add ../totem-site site
cd ../totem-site
node scripts/build-site.js --app ../totem      # writes dist/
python3 -m http.server -d dist 8000           # to look at it
```

The build stops on a link, an image or a section that leads nowhere, on an icon that the font of the websites does not have, and on a placeholder that was not filled.

The screenshots (`node scripts/screenshots.js --app ../totem`) need Chrome and Ollama with a small model: a temporary Totem with a made-up project, a real model for the answer about Total.js and a scripted demo model for the rest. The application of the screenshots `project` and `built` is planned, built task by task, checked and started for real; only the text of its files comes from the demo model. `node scripts/og.js` makes the social card.

## How it is published

The workflow `pages.yml` of `main` checks out both branches, builds the website and publishes it to GitHub Pages. It runs when `docs/`, the README, the changelog or the version change in `main`, and when this branch changes (the workflow here asks for it). Pages must be set to *GitHub Actions* as its source.
