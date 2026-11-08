// Formatters run after a tool wrote a file. A project chooses them in .totem/formatters.json:
//
//   { "prettier": { "command": ["node_modules/.bin/prettier", "--write", "$FILE"], "extensions": [".js", ".json"] }, "disabled": ["gofmt"] }
//
// Without that file Totem uses the formatter that the project already has: a local prettier, gofmt for Go, rustfmt for Rust, ruff for Python with a [tool.ruff] section.
// The first formatter that matches the extension and exits with 0 wins. `formatter : false` in the config turns all of them off.

exports.id = 'formatter';

var TIMEOUT = 20000;
var WEB = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.html', '.vue', '.md', '.yml', '.yaml'];

function exists(path) {
	try {
		return Total.Fs.existsSync(path);
	} catch (e) {
		return false;
	}
}

function read(path) {
	try {
		return Total.Fs.readFileSync(path, 'utf8');
	} catch (e) {
		return '';
	}
}

// [{ name, command, extensions }]
exports.list = function(root) {

	var custom = {};

	try {
		custom = JSON.parse(read(Total.Path.join(root, '.totem/formatters.json')) || '{}');
	} catch (e) {}

	var disabled = Array.isArray(custom.disabled) ? custom.disabled : [];
	var list = [];

	for (var name in custom) {
		var item = custom[name];
		if (name !== 'disabled' && item && Array.isArray(item.command) && Array.isArray(item.extensions))
			list.push({ name: name, command: item.command, extensions: item.extensions });
	}

	var local = Total.Path.join(root, 'node_modules/.bin/prettier');

	if (exists(local))
		list.push({ name: 'prettier', command: [local, '--write', '$FILE'], extensions: WEB });

	if (exists(Total.Path.join(root, 'go.mod')))
		list.push({ name: 'gofmt', command: ['gofmt', '-w', '$FILE'], extensions: ['.go'] });

	if (exists(Total.Path.join(root, 'Cargo.toml')))
		list.push({ name: 'rustfmt', command: ['rustfmt', '$FILE'], extensions: ['.rs'] });

	if (/\[tool\.ruff/.test(read(Total.Path.join(root, 'pyproject.toml'))))
		list.push({ name: 'ruff', command: ['ruff', 'format', '$FILE'], extensions: ['.py'] });

	return list.filter(item => disabled.indexOf(item.name) === -1);
};

// Formats a file that was just written. Returns a note for the model ('' when nothing changed or nothing applies)
exports.run = function(root, full, conf) {

	if ((conf || CONF).formatter === false)
		return '';

	var extension = Total.Path.extname(full).toLowerCase();
	var before = read(full);

	for (var item of exports.list(root)) {

		if (item.extensions.indexOf(extension) === -1)
			continue;

		var args = item.command.slice(1).map(arg => arg === '$FILE' ? full : arg);
		var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8' };
		var result = Total.Child.spawnSync(item.command[0], args, { cwd: root, env: env, timeout: TIMEOUT });

		if (result.error || result.status !== 0)
			continue;

		return read(full) !== before ? '\n\nFormatted with {0}. Read the file again before the next edit.'.format(item.name) : '';
	}

	return '';
};
