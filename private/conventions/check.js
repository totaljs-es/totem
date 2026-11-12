'use strict';

// Checks Total.js 5 application files against the rules of these conventions that a script can decide.
// It is a tooling script that runs with plain Node.js, without dependencies: it is not part of a Total.js application.
//
//   node tools/check.js <file|directory> ...    checks the files, exit code 1 when something must be fixed
//   node tools/check.js --strict <path> ...     style findings fail too
//   node tools/check.js --json <path> ...       prints the findings as JSON
//   node tools/check.js --hook                  reads a Claude Code PostToolUse event from stdin and checks what the edit wrote
//
// Severity: error = a defect or a rule without exception, warn = a rule with legacy exceptions, style = a preference for new code.

var Fs = require('fs');
var Path = require('path');
var Vm = require('vm');

var BACKEND = /^(schemas|controllers|definitions|modules|plugins|actions|jobs|middleware)$/;
var SKIPPED = /(^|\/)(node_modules|--bundles--|private|docs|tests)(\/|$)/;
var NODE_MODULES = 'fs|path|crypto|os|http|https|zlib|child_process|url|util|stream|net|dns|tls|cluster|worker_threads|readline|buffer|events|querystring|assert';

// Rules on a single line: [id, severity, expression, message, files]. `files` is "js" or "html".
var LINE_RULES = [
	['node-require', 'error', new RegExp('\\brequire\\(\\s*[\'"](?:node:)?(?:' + NODE_MODULES + ')[\'"]\\s*\\)'), 'Do not require() a Node.js module in application code: use Total.Fs, Total.Path, Total.Crypto, Total.Os...', 'js'],
	['module-path', 'warn', /\brequire\(\s*PATH\.root\(/, 'Use the module through MODS instead of requiring its path.', 'js'],
	['total-case', 'error', /\bTotal\.(OS|FS|PATH|CRYPTO|ZLIB|HTTP|HTTPS|CHILD|URL|UTIL|STREAM)\b/, 'The properties are case-sensitive: Total.Os, Total.Fs, Total.Path...', 'js'],
	['name-separator', 'warn', /\bNEW(?:ACTION|SCHEMA)\(\s*'@?[^']*[\/\\][^']*'/, 'Action and schema names use | between the parts (Tickets|list). Update registrations and callers together.', 'js'],
	['route-target', 'warn', /-->\s*@?[A-Za-z0-9_]+\/[A-Za-z0-9_|\/]+/, 'The action in the route uses / as separator: use | (Tickets|list) and rename the action with it.', 'js'],
	['user-text', 'warn', /(?:\$\.invalid|\.error)\(\s*'(?!@\()(?=[^']*[A-Za-z]{2,}\s+[A-Za-z])[^']*'/, 'Text for people must be marked for translation: @(Text).', 'js'],
	['inline-handler', 'error', /\son(?:click|change|input|submit|keyup|keydown|focus|blur)\s*=\s*["']/i, 'Use the class "exec" with data-exec instead of an inline handler.', 'html'],
	['add-listener', 'warn', /\.addEventListener\(\s*['"]click['"]/, 'Buttons call plugin functions with the class "exec" and data-exec.', 'html'],
	['plain-http', 'warn', /\b(?:fetch\(\s*['"`\/]|new XMLHttpRequest|\$\.ajax\()/, 'Call the server with exports.tapi() or the app helper, not with a second HTTP client.', 'html'],
	['plain-text', 'warn', /<(?:button|h[1-4]|label|th|legend)(?:\s[^>]*)?>\s*(?![@{~<\d])[A-Z][a-z]+(?:\s[^<{@~]*)?<\//, 'Text for people must be marked for translation: @(Text).', 'html']
];

// Rules counted once per file: [id, severity, expression, message, files]
var COUNT_RULES = [
	['spaces-indent', 'style', /^ {2,}\S/, 'Indent with tabs.', 'js'],
	// A constant or a let at the top of a file is allowed when the project needs it; inside a function the ES5 form is preferred
	['let-const', 'style', /^\s+(?:let|const)\s/, 'Inside a function new code prefers var.', 'js'],
	['template-literal', 'style', /^[^'"\/]*`/, 'New code prefers \'{0}\'.format() to template literals.', 'js']
];

function finding(file, line, rule, severity, message) {
	return { file: file, line: line, rule: rule, severity: severity, message: message };
}

function kind(file) {
	if (/\.min[.@]/.test(file))
		return '';
	if (/\.js$/.test(file))
		return 'js';
	if (/\.html$/.test(file))
		return 'html';
	return '';
}

// The root of the Total.js application: the nearest folder with a package.json that depends on total5
exports.root = function(file) {
	var dir = Path.dirname(Path.resolve(file));
	while (true) {
		var pkg = Path.join(dir, 'package.json');
		if (Fs.existsSync(pkg)) {
			try {
				var meta = JSON.parse(Fs.readFileSync(pkg, 'utf8'));
				if ((meta.dependencies && meta.dependencies.total5) || (meta.devDependencies && meta.devDependencies.total5))
					return dir;
			} catch (e) {}
		}
		var parent = Path.dirname(dir);
		if (parent === dir)
			return '';
		dir = parent;
	}
};

// Which kind of file this is inside the application: 'js' (server code), 'html' (plugin or view) or '' (not checked)
exports.zone = function(file, root) {
	var type = kind(file);
	if (!type)
		return '';
	var relative = Path.relative(root, Path.resolve(file)).split(Path.sep).join('/');
	if (relative.indexOf('..') === 0 || SKIPPED.test(relative))
		return '';
	var parts = relative.split('/');
	if (type === 'js')
		return BACKEND.test(parts[0]) && parts.length > 1 && parts.indexOf('public') === -1 ? 'js' : '';
	return parts[0] === 'plugins' || parts[0] === 'views' || parts[0] === 'public' || parts[0] === 'templates' ? 'html' : '';
};

function scripts(text) {
	var found = [];
	var regex = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
	var match;
	while ((match = regex.exec(text))) {
		var attributes = match[1] || '';
		if (/\ssrc=/.test(attributes) || (/\stype=/.test(attributes) && !/type=["']?(?:text\/javascript|module)/.test(attributes)))
			continue;
		var start = text.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1;
		found.push({ code: match[2], line: start });
	}
	return found;
}

function syntax(code) {

	// Server-side template tokens outside of a string (@{...}, return @(...)) are not JavaScript until they are rendered
	if (/@\{/.test(code) || /[^'"`(\w]@\(/.test(code))
		return '';

	try {
		new Vm.Script('(async function(){' + code + '\n})', { filename: 'check' });
		return '';
	} catch (e) {
		return e.message;
	}
}

// Checks a text. options.file is the path (for names), options.type is 'js' or 'html', options.offset is the line where a partial text starts
exports.text = function(text, options) {

	var file = options.file;
	var type = options.type;
	var offset = options.offset || 0;
	var found = [];
	var lines = text.split('\n');
	var block = false;

	for (var i = 0; i < lines.length; i++) {

		var line = lines[i];
		var trimmed = line.trim();

		// Comments are not code
		if (block) {
			if (trimmed.indexOf('*/') !== -1)
				block = false;
			continue;
		}

		if (trimmed.indexOf('/*') === 0 && trimmed.indexOf('*/') === -1) {
			block = true;
			continue;
		}

		if (trimmed.indexOf('//') === 0)
			continue;

		for (var j = 0; j < LINE_RULES.length; j++) {
			var rule = LINE_RULES[j];
			if (rule[4] === type && rule[2].test(line))
				found.push(finding(file, offset + i + 1, rule[0], rule[1], rule[3]));
		}
	}

	for (var k = 0; k < COUNT_RULES.length; k++) {
		var count = COUNT_RULES[k];
		if (count[4] !== type)
			continue;
		var first = 0;
		var total = 0;
		var inside = false;
		for (var n = 0; n < lines.length; n++) {
			var current = lines[n];
			if (inside) {
				if (current.indexOf('*/') !== -1)
					inside = false;
				continue;
			}
			if (current.trim().indexOf('/*') === 0 && current.indexOf('*/') === -1) {
				inside = true;
				continue;
			}
			if (current.trim().indexOf('//') === 0 || (count[0] === 'spaces-indent' && /^ +\*/.test(current)))
				continue;
			if (count[2].test(current)) {
				total++;
				if (!first)
					first = n + 1;
			}
		}
		if (total)
			found.push(finding(file, offset + first, count[0], count[1], count[3] + ' (' + total + (total === 1 ? ' line' : ' lines') + ')'));
	}

	return found;
};

// Checks a complete file: the rules above plus the syntax
exports.file = function(file, root) {

	root = root || exports.root(file);
	if (!root)
		return [];

	var type = exports.zone(file, root);
	if (!type)
		return [];

	var text = Fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
	var relative = Path.relative(root, file).split(Path.sep).join('/');
	var found = exports.text(text, { file: relative, type: type });

	if (type === 'js') {

		if (!/^[a-z0-9\-.]+\.js$/.test(Path.basename(file)))
			found.push(finding(relative, 1, 'file-name', 'warn', 'File names are lowercase with -.'));

		if (text.indexOf('#!') !== 0) {
			var error = syntax(text);
			if (error)
				found.push(finding(relative, 1, 'syntax', 'error', error));
		}

	} else {
		scripts(text).forEach(function(script) {
			var error = syntax(script.code);
			if (error)
				found.push(finding(relative, script.line + 1, 'syntax', 'error', 'Script: ' + error));
		});
	}

	return found;
};

function walk(path, files) {
	var stat = Fs.statSync(path);
	if (stat.isDirectory()) {
		Fs.readdirSync(path).forEach(function(name) {
			if (name !== 'node_modules' && name !== '.git')
				walk(Path.join(path, name), files);
		});
	} else
		files.push(path);
	return files;
}

exports.paths = function(paths) {
	var found = [];
	paths.forEach(function(path) {
		walk(path, []).forEach(function(file) {
			found = found.concat(exports.file(file));
		});
	});
	return found;
};

function print(findings) {
	return findings.map(function(item) {
		return item.file + ':' + item.line + ' ' + item.severity + ' ' + item.rule + ': ' + item.message;
	}).join('\n');
}

// The text that an edit wrote, with the line where it starts in the file
function written(input, content) {

	var items = [];

	if (typeof(input.content) === 'string')
		items.push(input.content);
	if (typeof(input.new_string) === 'string')
		items.push(input.new_string);
	if (Array.isArray(input.edits)) {
		input.edits.forEach(function(edit) {
			if (edit && typeof(edit.new_string) === 'string')
				items.push(edit.new_string);
		});
	}

	return items.map(function(text) {
		var index = content.indexOf(text);
		return { text: text.replace(/\r\n/g, '\n'), offset: index === -1 ? 0 : content.slice(0, index).split('\n').length - 1 };
	});
}

// Claude Code PostToolUse: findings about what the edit wrote go to stderr with exit code 2, so the agent corrects them
exports.hook = function(event) {

	var input = event && event.tool_input;
	var file = input && input.file_path;

	if (!file || !Fs.existsSync(file))
		return { code: 0, message: '' };

	var root = exports.root(file);
	var type = root && exports.zone(file, root);

	if (!type)
		return { code: 0, message: '' };

	var content = Fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
	var relative = Path.relative(root, file).split(Path.sep).join('/');
	var found = [];

	written(input, content).forEach(function(item) {
		found = found.concat(exports.text(item.text, { file: relative, type: type, offset: item.offset }));
	});

	if (type === 'js') {
		if (content.indexOf('#!') !== 0) {
			var error = syntax(content);
			if (error)
				found.push(finding(relative, 1, 'syntax', 'error', error));
		}
	} else {
		scripts(content).forEach(function(script) {
			var error = syntax(script.code);
			if (error)
				found.push(finding(relative, script.line + 1, 'syntax', 'error', 'Script: ' + error));
		});
	}

	if (!found.length)
		return { code: 0, message: '' };

	return { code: 2, message: 'Total.js conventions: fix these in ' + relative + ' (rules: backend/, frontend/ and general/ pages of the conventions)\n' + print(found) };
};

if (require.main === module) {

	var args = process.argv.slice(2);

	if (args.indexOf('--hook') !== -1) {

		var raw = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', function(chunk) {
			raw += chunk;
		});
		process.stdin.on('end', function() {
			var event;
			try {
				event = JSON.parse(raw);
			} catch (e) {
				process.exit(0);
			}
			var result = exports.hook(event);
			if (result.message)
				process.stderr.write(result.message + '\n');
			process.exit(result.code);
		});

	} else {

		var strict = args.indexOf('--strict') !== -1;
		var json = args.indexOf('--json') !== -1;
		var paths = args.filter(function(arg) {
			return arg.indexOf('--') !== 0;
		});

		if (!paths.length) {
			process.stderr.write('Usage: node tools/check.js [--strict] [--json] <file|directory> ...\n');
			process.exit(2);
		}

		var findings = exports.paths(paths);
		var failing = findings.filter(function(item) {
			return strict || item.severity !== 'style';
		});

		if (json)
			process.stdout.write(JSON.stringify(findings, null, '\t') + '\n');
		else if (findings.length)
			process.stdout.write(print(findings) + '\n');

		process.exit(failing.length ? 1 : 0);
	}
}
