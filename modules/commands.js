// Custom commands: a prompt in a file, run with /name and arguments. They live in .totem/commands/*.md:
//
//   ---
//   description: Review a file
//   ---
//   Review $ARGUMENTS and list the problems by severity.

exports.id = 'commands';

// The commands that come with Totem (private/commands) and the ones of the project; a command of the project with the same name wins
function load(dir, found) {

	var names;

	try {
		names = Total.Fs.readdirSync(dir);
	} catch (e) {
		return;
	}

	for (var file of names.filter(file => /\.md$/.test(file)).sort()) {
		var parsed = MODS.instructions.frontmatter(Total.Fs.readFileSync(Total.Path.join(dir, file), 'utf8'));
		var name = file.replace(/\.md$/, '');
		found[name] = { name: name, description: parsed.meta.description || '', template: parsed.body.trim() };
	}
}

exports.list = function(root) {
	var found = {};
	load(PATH.private('commands'), found);
	load(Total.Path.join(root, '.totem/commands'), found);
	return Object.keys(found).sort().map(key => found[key]);
};

// "/name arguments" -> the text of the command with $ARGUMENTS replaced, or null when the text is not a command of the project
exports.expand = function(root, text) {

	var match = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);

	if (!match)
		return null;

	var command = exports.list(root).findItem('name', match[1]);

	if (!command)
		return null;

	var args = (match[2] || '').trim();
	var template = command.template.indexOf('$PROJECT') === -1 ? command.template : command.template.split('$PROJECT').join(facts(root));
	var output = template.indexOf('$ARGUMENTS') === -1 ? (template + (args ? ('\n\n' + args) : '')) : template.split('$ARGUMENTS').join(args);

	return { name: command.name, text: output };
};

// $PROJECT in a command: what Totem already knows about the folder (its first level, package.json, the start of the README and of AGENTS.md), so that a
// model that reads badly does not have to go and read it. Nothing is invented: only what is in the files.
var SKIP = /^(node_modules|\.git|\.totem|databases|tmp|logs|\.DS_Store)$/;

function head(root, name, lines, chars) {
	try {
		return Total.Fs.readFileSync(Total.Path.join(root, name), 'utf8').split('\n').slice(0, lines).join('\n').substring(0, chars).trim();
	} catch (e) {
		return '';
	}
}

function facts(root) {

	var out = [];
	var names = [];

	try {
		names = Total.Fs.readdirSync(root, { withFileTypes: true }).filter(entry => !SKIP.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
	} catch (e) {}

	out.push('Facts of the project, read by Totem (you do not need to read these files again):');
	out.push('First level: ' + (names.length ? names.map(entry => entry.name + (entry.isDirectory() ? '/' : '')).join(', ') : '(empty folder)'));

	var pkg = null;

	try {
		pkg = JSON.parse(Total.Fs.readFileSync(Total.Path.join(root, 'package.json'), 'utf8'));
	} catch (e) {}

	if (pkg) {
		out.push('package.json: name ' + (pkg.name || '?') + (pkg.description ? ', ' + pkg.description : '') + (pkg.scripts ? '; scripts: ' + Object.keys(pkg.scripts).map(key => key + ' = ' + pkg.scripts[key]).join('; ') : '; no scripts') + '; dependencies: ' + (Object.keys(pkg.dependencies || {}).join(', ') || 'none'));
	}

	var readme = head(root, 'README.md', 30, 1500);
	readme && out.push('README.md (start):\n' + readme);

	var agents = head(root, 'AGENTS.md', 60, 2500);
	agents && out.push('AGENTS.md (current):\n' + agents);

	return out.join('\n');
}

exports.facts = facts;

// AGENTS.md for a model that cannot write it (a model of 1.5 billion parameters reads the facts and says that the folder is empty): the file is made
// from what is in the project, and nothing else. '' when AGENTS.md already exists (it is not replaced, and it is not guessed what to keep).
var FOLDERS = { controllers: 'routes', schemas: 'actions', definitions: 'code that runs at the start (AUTH, FUNC, MAIN)', modules: 'shared code, used through MODS', plugins: 'the interface of the application', views: 'pages', public: 'static files', resources: 'translations', private: 'files that are not served', tests: 'tests', docs: 'documentation', scripts: 'tools', bin: 'commands', databases: 'data (not committed)' };

exports.agents = function(root) {

	if (Total.Fs.existsSync(Total.Path.join(root, 'AGENTS.md')))
		return '';

	var pkg = {};

	try {
		pkg = JSON.parse(Total.Fs.readFileSync(Total.Path.join(root, 'package.json'), 'utf8'));
	} catch (e) {}

	var entries = [];

	try {
		entries = Total.Fs.readdirSync(root, { withFileTypes: true }).filter(entry => !SKIP.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
	} catch (e) {}

	var dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
	var files = entries.filter(entry => !entry.isDirectory()).map(entry => entry.name);
	var total = !!((pkg.dependencies || {}).total5 || (pkg.dependencies || {}).total4);
	var out = ['# ' + (pkg.name || Total.Path.basename(root)), ''];

	if (pkg.description)
		out.push(pkg.description, '');

	if (dirs.length || files.length) {
		out.push('## Layout', '');
		dirs.forEach(name => out.push('- `' + name + '/`' + (FOLDERS[name] ? ': ' + FOLDERS[name] : '')));
		files.filter(name => /^(index\.js|config|package\.json|README\.md|Dockerfile|docker-compose\.yml)$/.test(name)).forEach(name => out.push('- `' + name + '`'));
		out.push('');
	}

	var run = [];
	var scripts = Object.keys(pkg.scripts || {});

	if (files.indexOf('package.json') !== -1)
		run.push('- Install: `npm install`');

	scripts.forEach(key => run.push('- `npm run ' + key + '`: `' + pkg.scripts[key] + '`'));

	if (!scripts.length && files.indexOf('index.js') !== -1)
		run.push('- Start: `node index.js`');

	run.length && out.push('## Run', '', run.join('\n'));

	if (total) {
		out.push('', '## Conventions', '');
		out.push('- Total.js 5: ES5 (`var`, `function`), indented with tabs, no `require()` of Node.js modules (use `Total.Fs`, `Total.Path`...).');
		out.push('- Actions are `NEWACTION` in `schemas/` with names like `Collection|verb`; routes are `ROUTE()` in `controllers/`.');
		out.push('- Shared helpers go in `FUNC`, shared state in `MAIN`, modules through `MODS`.');
	}

	return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
};

// /new: the files of a minimal Total.js 5 application, the same for every model (they are fixed text, a model would only get them wrong).
// [{ path, content }] without the ones that exist, and the names of the ones that exist: { files, skipped }
exports.scaffold = function(root, name) {

	var title = (name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || (Total.Path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app');
	var version = '0.0.20-1';

	try {
		version = JSON.parse(Total.Fs.readFileSync(PATH.root('package.json'), 'utf8')).dependencies.total5 || version;
	} catch (e) {}

	var all = [
		{ path: 'package.json', content: JSON.stringify({ name: title, version: '1.0.0', private: true, scripts: { start: 'node index.js' }, dependencies: { total5: version } }, null, '\t') + '\n' },
		{ path: 'index.js', content: "require('total5');\n\nvar options = {};\nF.run(options);\n" },
		{ path: 'config', content: 'name                        : ' + title + '\nversion                     : 1.0.0\n' },
		{ path: 'controllers/index.js', content: "exports.install = function() {\n\tROUTE('GET /', index);\n};\n\nfunction index($) {\n\t$.plain('Hello from " + title + "');\n}\n" }
	];

	var files = [];
	var skipped = [];

	all.forEach(file => (Total.Fs.existsSync(Total.Path.join(root, file.path)) ? skipped : files).push(file));

	return { files: files, skipped: skipped.map(file => file.path) };
};
