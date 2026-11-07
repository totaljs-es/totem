#!/usr/bin/env node
'use strict';

// The card that social networks show when the website is shared (img/og.jpg, 1200 x 630): the name and Toto, no sentences, like the cards of the other
// Spanish Total.js websites, so it never goes out of date. Needs Google Chrome (headless) and the macOS tool `sips` for the JPEG.
// A tooling script that runs with plain Node.js: it is not part of the application.
//
//   node scripts/og.js

const Child = require('child_process');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = Path.join(ROOT, 'img/og.jpg');

if (!Fs.existsSync(CHROME)) {
	console.error('Google Chrome is needed (set CHROME_PATH if it is somewhere else).');
	process.exit(1);
}

const font = Path.join(ROOT, 'vendor/fonts/manrope-latin.woff2');
const toto = Path.join(ROOT, 'img/toto/toto-coding.webp');
const logo = Path.join(ROOT, 'img/brand/totem-light.svg');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Manrope;font-weight:200 800;src:url(file://${font}) format('woff2')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:#fff9f2;font-family:Manrope,Arial,sans-serif;color:#202b34;position:relative}
.dot{position:absolute;left:-160px;bottom:-220px;width:620px;height:620px;border-radius:50%;background:#ffead4}
.toto{position:absolute;right:30px;top:20px;width:590px;height:590px}
.logo{position:absolute;left:84px;top:84px;width:92px;height:92px}
.kicker{position:absolute;left:84px;top:254px;font-size:22px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#b34400}
h1{position:absolute;left:80px;top:290px;margin:0;font-size:150px;line-height:1;letter-spacing:-.06em;font-weight:800}
</style></head><body><div class="dot"></div><img class="toto" src="file://${toto}"><img class="logo" src="file://${logo}">
<div class="kicker">Spanish Total.js</div><h1>Totem</h1></body></html>`;

const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totem-og-'));
const page = Path.join(dir, 'og.html');
const png = Path.join(dir, 'og.png');
Fs.writeFileSync(page, html);

const result = Child.spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1200,630', '--virtual-time-budget=4000', '--screenshot=' + png, 'file://' + page], { stdio: 'ignore' });

if (result.status !== 0 || !Fs.existsSync(png)) {
	console.error('Chrome could not render the card.');
	process.exit(1);
}

Fs.mkdirSync(Path.dirname(OUT), { recursive: true });
Child.execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', OUT], { stdio: 'ignore' });
Fs.rmSync(dir, { recursive: true, force: true });
console.log('Written ' + Path.relative(ROOT, OUT) + ' (' + Math.round(Fs.statSync(OUT).size / 1024) + ' kB)');
