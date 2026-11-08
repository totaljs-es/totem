// Diagnostics run after a tool wrote a file. They are the checks that the project already has, so the model sees a broken file
// in the same step and not after the next test run. A project chooses them in .totem/diagnostics.json:
//
//   { "eslint": { "command": ["node_modules/.bin/eslint", "$FILE"], "extensions": [".js"] }, "disabled": ["node"] }
//
// Without that file Totem uses what the project has: `node --check` for JavaScript, a JSON parse for .json, a local tsc with tsconfig.json,
// `go vet` with go.mod, `cargo check` with Cargo.toml, `ruff check` with a [tool.ruff] section and `python3 -m py_compile` for the rest of Python.
// A check that exits with 0 says nothing. A check that exits with another code reports its output to the model. A tool that is not installed is skipped.
// `diagnostics : false` in the config turns all of them off.

exports.id = 'diagnostics';

var TIMEOUT = 30000;
var MAXOUTPUT = 3000;
var SCRIPT = ['.js', '.mjs', '.cjs'];

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
		custom = JSON.parse(read(Total.Path.join(root, '.totem/diagnostics.json')) || '{}');
	} catch (e) {}

	var disabled = Array.isArray(custom.disabled) ? custom.disabled : [];
	var list = [];

	for (var name in custom) {
		var item = custom[name];
		if (name !== 'disabled' && item && Array.isArray(item.command) && Array.isArray(item.extensions))
			list.push({ name: name, command: item.command, extensions: item.extensions });
	}

	list.push({ name: 'json', command: null, extensions: ['.json'] });
	list.push({ name: 'node', command: [process.execPath, '--check', '$FILE'], extensions: SCRIPT });

	var tsc = Total.Path.join(root, 'node_modules/.bin/tsc');
	if (exists(tsc) && exists(Total.Path.join(root, 'tsconfig.json')))
		list.push({ name: 'tsc', command: [tsc, '--noEmit', '-p', '.'], extensions: ['.ts', '.tsx'] });

	if (exists(Total.Path.join(root, 'go.mod')))
		list.push({ name: 'go vet', command: ['go', 'vet', './...'], extensions: ['.go'] });

	if (exists(Total.Path.join(root, 'Cargo.toml')))
		list.push({ name: 'cargo check', command: ['cargo', 'check', '--quiet', '--message-format', 'short'], extensions: ['.rs'] });

	if (/\[tool\.ruff/.test(read(Total.Path.join(root, 'pyproject.toml'))))
		list.push({ name: 'ruff', command: ['ruff', 'check', '$FILE'], extensions: ['.py'] });
	else
		list.push({ name: 'python', command: ['python3', '-m', 'py_compile', '$FILE'], extensions: ['.py'] });

	return list.filter(item => disabled.indexOf(item.name) === -1);
};

// Checks a file that was just written. Returns a note for the model ('' when nothing is wrong or nothing applies)
exports.run = function(root, full, conf) {

	if ((conf || CONF).diagnostics === false)
		return '';

	var extension = Total.Path.extname(full).toLowerCase();

	if (extension === '.json' && exports.list(root).some(item => item.name === 'json')) {
		try {
			JSON.parse(read(full));
		} catch (e) {
			return '\n\nProblems found by json in {0}:\n{1}'.format(Total.Path.basename(full), e.message);
		}
	}

	var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8' };
	var notes = '';

	for (var item of exports.list(root)) {

		if (!item.command || item.extensions.indexOf(extension) === -1)
			continue;

		var args = item.command.slice(1).map(arg => arg === '$FILE' ? full : arg);
		var result = Total.Child.spawnSync(item.command[0], args, { cwd: root, env: env, timeout: TIMEOUT, encoding: 'utf8' });

		if (result.error || result.status === null || result.status === 0)
			continue;

		var output = ((result.stderr || '') + (result.stdout || '')).split(full).join(Total.Path.relative(root, full)).trim();
		output = FUNC.truncate(FUNC.scrub(output), MAXOUTPUT);

		if (output)
			notes += '\n\nProblems found by {0} in {1}:\n{2}'.format(item.name, Total.Path.relative(root, full), output);
	}

	return notes;
};
