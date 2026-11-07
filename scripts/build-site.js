'use strict';

// The website of Totem: the pages of docs/ turned into HTML, around the home page in site/. The look is the one of the Spanish Total.js websites
// (the corp repository): site/css/corp.css and the styles of the CDN, with the header and the footer of those websites.
// No dependencies. `node scripts/build-site.js` writes dist/, which GitHub Pages publishes. A link that leads nowhere stops the build.
// (The Markdown converter and the highlighter come from the website of TotalFusion, same team and license.)

const Fs = require('fs');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');
const DOCS = Path.join(ROOT, 'docs');
const SITE = Path.join(ROOT, 'site');
const PACKAGE = JSON.parse(Fs.readFileSync(Path.join(ROOT, 'package.json'), 'utf8'));

const ORIGIN = 'https://totaljs-es.github.io/totem/';
const REPOSITORY = 'https://github.com/totaljs-es/totem/';

// The order and the groups of the menu
const NAVIGATION = [
	{ name: 'Start here', pages: ['docs/getting-started.md', 'docs/guide.md', 'docs/help.md'] },
	{ name: 'Total.js knowledge', pages: ['docs/knowledge.md'] },
	{ name: 'Run it', pages: ['docs/delivery.md', 'docs/security.md'] },
	{ name: 'How it works', pages: ['docs/README.md', 'docs/vision.md', 'docs/architecture.md', 'docs/agent-loop.md', 'docs/data-model.md', 'docs/protocol.md', 'docs/interface.md', 'docs/capabilities.md'] },
	{ name: 'Project', pages: ['docs/roadmap.md', 'docs/decisions.md', 'CHANGELOG.md'] }
];

// The Spanish Total.js network, as in the header of its websites
const NETWORK = [['Spanish Total.js', 'https://totaljs.es/en/'], ['TotalDesktop', 'https://totaldesktop.totaljs.es/'], ['TotalIDE', 'https://totalide.totaljs.es/'], ['TotalVM', 'https://totalvm.totaljs.es/en/'], ['TotalMail', 'https://totalmail.totaljs.es/en/'], ['Forge', 'https://forge.totaljs.es/en/'], ['Totem', ORIGIN]];

// Where a page of the repository is published
function output(file) {

	if (file === 'README.md')
		return 'index.html';

	if (file === 'CHANGELOG.md')
		return 'docs/changelog.html';

	if (file === 'docs/README.md')
		return 'docs/index.html';

	return file.replace(/\.md$/, '.html');
}

function escape(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The anchors that GitHub gives to the headings, the same as the tests of the documentation
function slugger() {
	const seen = {};
	return function(text) {
		const slug = text.replace(/`|\*\*|\*/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
		const id = seen[slug] ? slug + '-' + seen[slug] : slug;
		seen[slug] = (seen[slug] || 0) + 1;
		return id;
	};
}

// ---- Code ----------------------------------------------------------------------------------------------------------

const KEYWORDS = {
	js: 'const let var function return if else for while await async new class extends exports require true false null undefined of in throw try catch finally typeof switch case break continue this',
	python: 'def class return if elif else for while import from as with try except finally raise yield async await lambda None True False in is not and or pass',
	go: 'func package import return if else for range var const type struct interface map chan go defer select switch case default nil true false string int bool error',
	rust: 'fn let mut use mod pub struct impl enum match if else for while loop return const static trait where self Self true false as in ref move async await',
	bash: 'npm npx node cargo go python pip cd export git',
	toml: 'true false',
	json: 'true false null'
};

const LANGUAGES = { js: 'js', javascript: 'js', json: 'json', python: 'python', py: 'python', go: 'go', rust: 'rust', bash: 'bash', sh: 'bash', toml: 'toml' };

function highlight(code, language) {

	const lang = LANGUAGES[language];

	if (!lang)
		return escape(code);

	const parts = [];

	if (lang === 'js' || lang === 'go' || lang === 'rust')
		parts.push('(?<c>\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/)');
	else if (lang === 'python' || lang === 'toml')
		parts.push('(?<c>#.*)');
	else if (lang === 'bash')
		parts.push('(?<c>(?<![^\\s])#.*)');

	if (lang === 'python')
		parts.push('(?<s>"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')');
	else if (lang === 'rust')
		parts.push('(?<s>"(?:\\\\.|[^"\\\\])*")');
	else if (lang === 'js' || lang === 'go')
		parts.push('(?<s>"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)');
	else
		parts.push('(?<s>"(?:\\\\.|[^"\\\\\\n])*"|\'[^\'\\n]*\')');

	parts.push('(?<n>\\b\\d+(?:\\.\\d+)?\\b)');

	if (KEYWORDS[lang])
		parts.push('(?<k>\\b(?:' + KEYWORDS[lang].split(' ').join('|') + ')\\b)');

	const regexp = new RegExp(parts.join('|'), 'g');
	let html = '';
	let last = 0;
	let match;

	while ((match = regexp.exec(code))) {

		html += escape(code.slice(last, match.index));
		last = match.index + match[0].length;

		const type = match.groups.c !== undefined ? 'c' : match.groups.s !== undefined ? 's' : match.groups.n !== undefined ? 'n' : 'k';
		html += '<span class="hl-' + type + '">' + escape(match[0]) + '</span>';

		if (!match[0].length)
			regexp.lastIndex++;
	}

	return html + escape(code.slice(last));
}

// ---- Markdown ------------------------------------------------------------------------------------------------------
// The part of Markdown that the documentation uses: headings, paragraphs, lists, tables, code, quotes, links, emphasis.

const BLOCK = /^(```|#{1,6} |\s*[-*] |\s*\d+\. |>|\|)/;

function splitRow(line) {

	let text = line.trim();

	if (text.startsWith('|'))
		text = text.slice(1);

	if (text.endsWith('|') && !text.endsWith('\\|'))
		text = text.slice(0, -1);

	const cells = [];
	let current = '';
	let code = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\\' && text[i + 1] === '|') {
			current += '|';
			i++;
		} else if (c === '`') {
			code = !code;
			current += c;
		} else if (c === '|' && !code) {
			cells.push(current.trim());
			current = '';
		} else
			current += c;
	}

	cells.push(current.trim());
	return cells;
}

function isTableSeparator(line) {
	return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line || '');
}

function Renderer(file, pages, errors) {

	const slug = slugger();
	const headings = [];
	const self = this;

	// A link of the repository becomes a link of the website, or of GitHub when the target is not a page
	function link(url) {

		if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#'))
			return url;

		const hash = url.indexOf('#');
		const target = hash === -1 ? url : url.slice(0, hash);
		const fragment = hash === -1 ? '' : url.slice(hash);
		const resolved = Path.posix.normalize(Path.posix.join(Path.posix.dirname(file), target));

		if (pages[resolved])
			return Path.posix.relative(Path.posix.dirname(output(file)), output(resolved)) + fragment;

		const absolute = Path.join(ROOT, resolved);

		if (!Fs.existsSync(absolute)) {
			errors.push(file + ': ' + url + ' leads nowhere');
			return url;
		}

		return REPOSITORY + (Fs.statSync(absolute).isDirectory() ? 'tree/main/' : 'blob/main/') + resolved + fragment;
	}

	// An image of site/img goes with the website; any other goes to the repository
	function image(url) {

		if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//'))
			return url;

		const resolved = Path.posix.normalize(Path.posix.join(Path.posix.dirname(file), url));

		if (!Fs.existsSync(Path.join(ROOT, resolved))) {
			errors.push(file + ': the image ' + url + ' leads nowhere');
			return url;
		}

		if (resolved.startsWith('site/img/'))
			return Path.posix.relative(Path.posix.dirname(output(file)), resolved.slice('site/'.length));

		return REPOSITORY + 'raw/main/' + resolved;
	}

	this.inline = function(text) {

		const saved = [];
		const keep = html => '\u0000' + (saved.push(html) - 1) + '\u0000';

		// Code first: what is inside is never Markdown
		text = text.replace(/(`+)(.+?)\1/g, (m, ticks, code) => keep('<code>' + escape(code.trim()) + '</code>'));

		// Images and links before the text is escaped, with the text of the link as Markdown too
		text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => keep('<img src="' + escape(image(url)) + '" alt="' + escape(alt) + '" loading="lazy">'));
		text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) => {
			const href = link(url);
			const external = /^https?:/.test(href);
			return keep('<a href="' + escape(href) + '"' + (external ? ' rel="noopener"' : '') + '>') + label + keep('</a>');
		});

		text = escape(text);
		text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		text = text.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');

		let previous;

		do {
			previous = text;
			text = text.replace(/\u0000(\d+)\u0000/g, (m, index) => saved[+index]);
		} while (text !== previous);

		return text;
	};

	this.list = function(lines, start) {

		const first = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[start]);
		const ordered = /\d/.test(first[2]);
		const indent = first[1].length;
		const items = [];
		let i = start;

		while (i < lines.length) {

			const marker = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);

			if (!marker || marker[1].length !== indent || /\d/.test(marker[2]) !== ordered)
				break;

			const body = [marker[3]];
			const width = marker[1].length + marker[2].length + 1;
			i++;

			while (i < lines.length) {

				const line = lines[i];

				if (line.trim() === '') {
					// A blank line belongs to the item only when what follows is indented under it
					let j = i;
					while (j < lines.length && lines[j].trim() === '')
						j++;
					if (j < lines.length && lines[j].search(/\S/) >= width) {
						body.push('');
						i++;
						continue;
					}
					break;
				}

				const own = line.search(/\S/);

				if (own >= width)
					body.push(line.slice(Math.min(width, own)));
				else if (own > indent && /^(\s*)([-*]|\d+\.)\s+/.test(line))
					body.push(line.slice(Math.min(width, own)));
				else if (!BLOCK.test(line) && own > indent - 1 && !/^(\s*)([-*]|\d+\.)\s+/.test(line))
					body.push(line.trim());
				else
					break;

				i++;
			}

			items.push(body);
		}

		const html = items.map(body => {
			const simple = body.every(line => !BLOCK.test(line) && line.trim() !== '' || line === body[0]);
			return '<li>' + (simple ? self.inline(body.join(' ')) : self.blocks(body)) + '</li>';
		}).join('\n');

		return { html: '<' + (ordered ? 'ol' : 'ul') + '>\n' + html + '\n</' + (ordered ? 'ol' : 'ul') + '>', next: i };
	};

	this.blocks = function(lines) {

		const html = [];
		let i = 0;

		while (i < lines.length) {

			const line = lines[i];

			if (line.trim() === '') {
				i++;
				continue;
			}

			const fence = /^```\s*([\w-]*)/.exec(line);

			if (fence) {
				const code = [];
				i++;
				while (i < lines.length && !lines[i].startsWith('```'))
					code.push(lines[i++]);
				i++;
				html.push('<div class="code"><pre><code>' + highlight(code.join('\n'), fence[1].toLowerCase()) + '</code></pre></div>');
				continue;
			}

			const heading = /^(#{1,6}) (.+)$/.exec(line);

			if (heading) {
				const level = heading[1].length;
				const id = slug(heading[2]);
				headings.push({ level, id, text: heading[2].replace(/`|\*\*|\*/g, '') });
				html.push('<h' + level + ' id="' + id + '">' + self.inline(heading[2]) + (level > 1 ? '<a class="anchor" href="#' + id + '" aria-label="Link to this section">#</a>' : '') + '</h' + level + '>');
				i++;
				continue;
			}

			if (/^-{3,}$/.test(line.trim())) {
				html.push('<hr>');
				i++;
				continue;
			}

			if (line.trim().startsWith('|') && isTableSeparator(lines[i + 1])) {
				const head = splitRow(line);
				const rows = [];
				i += 2;
				while (i < lines.length && lines[i].trim().startsWith('|'))
					rows.push(splitRow(lines[i++]));
				const empty = head.every(cell => cell === '');
				html.push('<div class="table"><table>' + (empty ? '' : '<thead><tr>' + head.map(cell => '<th>' + self.inline(cell) + '</th>').join('') + '</tr></thead>') + '<tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + self.inline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
				continue;
			}

			if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
				const list = self.list(lines, i);
				html.push(list.html);
				i = list.next;
				continue;
			}

			if (line.startsWith('>')) {
				const quote = [];
				while (i < lines.length && lines[i].startsWith('>'))
					quote.push(lines[i++].replace(/^>\s?/, ''));
				html.push('<blockquote>' + self.blocks(quote) + '</blockquote>');
				continue;
			}

			const paragraph = [];

			while (i < lines.length && lines[i].trim() !== '' && (paragraph.length === 0 || !BLOCK.test(lines[i])))
				paragraph.push(lines[i++].trim());

			html.push('<p>' + self.inline(paragraph.join(' ')) + '</p>');
		}

		return html.join('\n');
	};

	this.render = function(markdown) {
		const body = this.blocks(markdown.split(/\r?\n/));
		return { body, headings };
	};
}

// The text of a page without Markdown, for the description and for the search
function plain(markdown) {
	return markdown.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*|>#]/g, '').replace(/^\s*-{3,}\s*$/gm, '').replace(/\s+/g, ' ').trim();
}

// ---- The site ------------------------------------------------------------------------------------------------------

function copy(from, to) {
	Fs.mkdirSync(Path.dirname(to), { recursive: true });
	Fs.cpSync(from, to, { recursive: true });
}

function write(dist, file, content) {
	const target = Path.join(dist, file);
	Fs.mkdirSync(Path.dirname(target), { recursive: true });
	Fs.writeFileSync(target, content);
}

// The header of the websites of the network: the brand, the main links and the network
function header(current, root) {

	const links = [['Docs', root + 'docs/getting-started.html'], ['Guide', root + 'docs/guide.html'], ['GitHub', REPOSITORY], ['npm', 'https://www.npmjs.com/package/totaljs-totem']]
		.map(item => '<a href="' + item[1] + '">' + item[0] + '</a>').join('');

	const network = NETWORK.map(item => '<a href="' + item[1] + '"' + (item[0] === 'Totem' ? ' aria-current="page"' : '') + '>' + item[0] + '</a>').join('');

	return '<header class="ec-header st-shell" style="--ec-accent:#bf4b05"><div class="ec-top"><a class="ec-brand" href="' + root + '"><img src="' + root + 'img/brand/toto-logo-96.webp" width="34" height="34" alt=""><span>Totem</span></a>'
		+ '<nav class="ec-primary" aria-label="Primary navigation">' + links + '</nav>'
		+ '<details class="ec-mobile"><summary aria-label="Open navigation menu"><span aria-hidden="true"><i class="ti ti-bars" aria-hidden="true"></i></span></summary><nav aria-label="Primary navigation">' + links + '</nav></details></div>'
		+ '<nav class="ec-network" aria-label="Total.js ecosystem">' + network + '</nav></header>';
}

// Fills the placeholders of a template. The body is last and by function: it can have any character
function fill(template, values) {

	let html = template;

	for (const key of Object.keys(values))
		html = html.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), () => values[key]);

	return html;
}

function build(dist) {

	const errors = [];
	const files = ['docs/README.md', 'CHANGELOG.md', ...Fs.readdirSync(DOCS).filter(name => name.endsWith('.md') && name !== 'README.md').map(name => 'docs/' + name)];
	const pages = {};

	for (const file of files)
		pages[file] = true;

	Fs.rmSync(dist, { recursive: true, force: true });
	Fs.mkdirSync(dist, { recursive: true });

	// What the pages need: the styles, the script, the fonts and the images
	for (const name of Fs.readdirSync(SITE)) {
		if (!['index.html', 'page.html', 'footer.html'].includes(name))
			copy(Path.join(SITE, name), Path.join(dist, name));
	}

	const template = Fs.readFileSync(Path.join(SITE, 'page.html'), 'utf8');
	const footer = Fs.readFileSync(Path.join(SITE, 'footer.html'), 'utf8');
	const order = [];

	for (const group of NAVIGATION)
		order.push(...group.pages);

	// First pass: render, so that the menu has the title of every page
	const rendered = {};

	for (const file of files) {
		const source = Fs.readFileSync(Path.join(ROOT, file), 'utf8');
		const result = new Renderer(file, pages, errors).render(source);
		const title = (result.headings.find(item => item.level === 1) || { text: file }).text;
		rendered[file] = { result, title, source };
	}

	// Every page of the documentation must be in the menu, and every page of the menu must exist
	for (const file of files) {
		if (!order.includes(file))
			errors.push(file + ' is not in the menu of the website');
	}

	for (const file of order) {
		if (!rendered[file])
			errors.push(file + ' is in the menu and does not exist');
	}

	const label = file => file === 'docs/README.md' ? 'Overview of the docs' : file === 'CHANGELOG.md' ? 'Changelog' : rendered[file].title.replace(/^Total\.js Totem:\s*/, '');

	function menu(current, absolute) {

		const from = Path.posix.dirname(output(current));
		const href = file => absolute ? ORIGIN + output(file) : Path.posix.relative(from, output(file));

		return NAVIGATION.map(group => '<div class="group"><h2>' + escape(group.name) + '</h2><ul>' + group.pages.filter(file => rendered[file]).map(file => '<li><a href="' + href(file) + '"' + (file === current ? ' aria-current="page"' : '') + '>' + escape(label(file)) + '</a></li>').join('') + '</ul></div>').join('');
	}

	const common = file => {
		const target = output(file);
		const depth = target.split('/').length - 1;
		return { root: depth ? '../'.repeat(depth) : './', target };
	};

	for (const file of Object.keys(rendered)) {

		const { result, title, source } = rendered[file];
		const { root, target } = common(file);
		const position = order.indexOf(file);
		const first = /^(?!#|\||```|\s*[-*]|>|!\[)(.+)$/m.exec(source.replace(/```[\s\S]*?```/g, ''));
		const description = plain(first ? first[1] : title).slice(0, 200);

		const neighbours = '<nav class="doc-neighbours" aria-label="Pages">' + [['prev', order[position - 1]], ['next', order[position + 1]]].filter(pair => pair[1]).map(pair => '<a class="' + pair[0] + '" href="' + Path.posix.relative(Path.posix.dirname(target), output(pair[1])) + '"><span>' + (pair[0] === 'prev' ? 'Previous' : 'Next') + '</span>' + escape(label(pair[1])) + '</a>').join('') + '</nav>';

		const toc = result.headings.filter(item => item.level === 2);
		const aside = toc.length > 2 ? '<nav class="doc-toc" aria-label="On this page"><h2>On this page</h2><ul>' + toc.map(item => '<li><a href="#' + item.id + '">' + escape(item.text) + '</a></li>').join('') + '</ul></nav>' : '';

		write(dist, target, fill(template, {
			root: root,
			origin: ORIGIN,
			title: escape(label(file)) + ' · Total.js Totem',
			description: escape(description),
			canonical: ORIGIN + target,
			header: header(file, root),
			footer: fill(footer, { root: root }),
			menu: menu(file),
			aside: aside,
			neighbours: neighbours,
			edit: REPOSITORY + 'edit/main/' + file,
			version: PACKAGE.version,
			body: result.body
		}));
	}

	// The home page
	write(dist, 'index.html', fill(Fs.readFileSync(Path.join(SITE, 'index.html'), 'utf8'), {
		root: './',
		origin: ORIGIN,
		title: 'Total.js Totem · An AI coding agent that knows Total.js',
		description: 'An AI coding environment written as a Total.js 5 application: an agent with tools, a diff you review, any model, and the knowledge of Total.js built in.',
		canonical: ORIGIN,
		header: header('index.html', './'),
		footer: fill(footer, { root: './' }),
		version: PACKAGE.version
	}));

	write(dist, '.nojekyll', '');
	write(dist, 'robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + ORIGIN + 'sitemap.xml\n');

	const urls = ['index.html', ...Object.keys(rendered).map(output)].sort();
	write(dist, 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(url => '<url><loc>' + ORIGIN + (url === 'index.html' ? '' : url) + '</loc></url>').join('\n') + '\n</urlset>\n');

	// A page that does not exist: it can be asked from any address, so everything in it is absolute
	write(dist, '404.html', fill(template, {
		root: ORIGIN,
		origin: ORIGIN,
		title: 'Page not found · Total.js Totem',
		description: 'This page does not exist.',
		canonical: ORIGIN,
		header: header('404.html', ORIGIN),
		footer: fill(footer, { root: ORIGIN }),
		menu: menu('docs/getting-started.md', true),
		aside: '',
		neighbours: '',
		edit: REPOSITORY,
		version: PACKAGE.version,
		body: '<h1>Page not found</h1><p>This page does not exist. Start from the <a href="' + ORIGIN + '">home page</a> or from <a href="' + ORIGIN + 'docs/getting-started.html">getting started</a>.</p>'
	}));

	// Every file that a page uses is in the site
	for (const page of [...Object.keys(rendered).map(file => common(file)), { root: './', target: 'index.html' }]) {
		const html = Fs.readFileSync(Path.join(dist, page.target), 'utf8');
		for (const match of html.matchAll(/(?:src|href|srcset)="((?:\.\.?\/)[^"#?\s]+)/g)) {
			const target = Path.normalize(Path.join(Path.dirname(Path.join(dist, page.target)), match[1]));
			if (!Fs.existsSync(target))
				errors.push(page.target + ': ' + match[1] + ' is not in the site');
		}
	}

	if (errors.length)
		throw new Error('The website has problems:\n' + [...new Set(errors)].join('\n'));

	return { pages: Object.keys(rendered).length + 1, dist };
}

module.exports = { build, Renderer, output, highlight };

if (require.main === module) {
	const result = build(Path.join(ROOT, 'dist'));
	console.log('Website: ' + result.pages + ' pages in ' + Path.relative(ROOT, result.dist));
}
