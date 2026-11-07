#!/usr/bin/env node
'use strict';

// The totem command. It is a tooling script that runs with plain Node.js 22 or newer: it is not part of the Total.js application.
//
//   totem                         starts the server and opens the browser
//   totem serve [port]            starts only the server (default port 8000)
//   totem run "prompt" [options]  runs one prompt without the interface and prints what happens
//   totem config                  prints the folders that Totem uses
//   totem --help
//
// Options of run: --project <folder> (default: the current folder), --model <provider:model>, --url <server> (default: a temporary
// local server), --token <token>, --auto-accept (edits run without asking), --yes (every question is answered "allow once").

var Child = require('child_process');
var Http = require('http');
var Net = require('net');
var Os = require('os');
var Path = require('path');

var ROOT = Path.join(__dirname, '..');

// Where the data goes. In a clone it stays in the folder of the application (databases/), which is what a developer expects. Installed from npm the
// folder of the application is not for what changes (it can be read only, and an update replaces it), so the data goes to a folder of the person.
function datafolder(opt) {

	if (opt && opt.data && opt.data !== true)
		return Path.resolve(opt.data);

	if (Path.relative(ROOT, __dirname) !== 'bin' || ROOT.split(Path.sep).indexOf('node_modules') === -1)
		return '';

	var home = Os.homedir();

	if (process.platform === 'darwin')
		return Path.join(home, 'Library', 'Application Support', 'Totem');

	if (process.platform === 'win32')
		return Path.join(process.env.APPDATA || Path.join(home, 'AppData', 'Roaming'), 'Totem');

	return Path.join(home, '.local', 'share', 'totem');
}

exports.datafolder = datafolder;

function usage() {
	console.log([
		'Usage:',
		'  totem                         start the server and open the browser',
		'  totem serve [port]            start only the server (default port 8000)',
		'  totem run "prompt" [options]  run a prompt without the interface',
		'  totem config                  print the folders that Totem uses',
		'',
		'Options of run:',
		'  --project <folder>   the project (default: the current folder)',
		'  --model <id>         provider:model, as listed in Settings',
		'  --url <address>      a running server (default: a temporary local server)',
		'  --token <token>      the access token of the server, when it has one',
		'  --auto-accept        file edits run without asking',
		'  --yes                every other question is answered "allow once"',
		'',
		'Options of serve and run:',
		'  --data <folder>      where the data goes (installed from npm: a folder of your user)'
	].join('\n'));
}

function options(args) {
	var out = { _: [] };
	for (var i = 0; i < args.length; i++) {
		if (args[i].indexOf('--') === 0) {
			var key = args[i].substring(2);
			if (key === 'yes' || key === 'auto-accept' || key === 'help')
				out[key] = true;
			else
				out[key] = args[++i];
		} else
			out._.push(args[i]);
	}
	return out;
}

function request(url, token, schema, data) {
	return new Promise(function(resolve, reject) {
		var u = new URL('/api/', url);
		var body = JSON.stringify({ schema: schema, data: data });
		var headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
		if (token)
			headers['x-token'] = token;
		var req = Http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: headers }, function(res) {
			var text = '';
			res.on('data', chunk => text += chunk);
			res.on('end', function() {
				var json;
				try {
					json = JSON.parse(text);
				} catch (e) {
					reject(new Error('Unexpected answer from the server (' + res.statusCode + ')'));
					return;
				}
				if (Array.isArray(json) && json[0] && json[0].error)
					reject(new Error(json[0].error));
				else
					resolve(json);
			});
		});
		req.on('error', reject);
		req.end(body);
	});
}

function freeport() {
	return new Promise(function(resolve) {
		var server = Net.createServer();
		server.listen(0, '127.0.0.1', function() {
			var port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

function serve(port, quiet, data) {
	var child = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port)].concat(data ? ['--data', data] : []), { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit', detached: true });
	var stop = function() {
		try {
			process.kill(-child.pid);
		} catch (e) {}
	};
	process.on('exit', stop);
	process.on('SIGINT', () => process.exit(130));
	process.on('SIGTERM', () => process.exit(143));
	return { child: child, stop: stop };
}

async function waitfor(url, token) {
	for (var i = 0; i < 100; i++) {
		try {
			await request(url, token, 'account');
			return true;
		} catch (e) {
			await new Promise(resolve => setTimeout(resolve, 150));
		}
	}
	return false;
}

function open(url) {
	var command = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'cmd' : 'xdg-open');
	var args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	Child.spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function run(opt) {

	var prompt = opt._.slice(1).join(' ');
	if (!prompt) {
		console.error('Missing prompt. Usage: totem run "prompt"');
		return 2;
	}

	var url = opt.url;
	var token = opt.token || '';
	var server = null;

	if (!url) {
		var port = await freeport();
		url = 'http://127.0.0.1:' + port;
		server = serve(port, true, datafolder(opt));
	}

	if (!await waitfor(url, token)) {
		console.error('The server does not answer at ' + url);
		server && server.stop();
		return 1;
	}

	var status = 1;

	try {

		var project = await request(url, token, 'projects_open', { path: Path.resolve(opt.project || process.cwd()) });
		var models = await request(url, token, 'providers_models');
		var model = opt.model || models[0];

		if (!model) {
			console.error('No model. Add a provider in the interface (Settings) or pass --model.');
			return 1;
		}

		var session = await request(url, token, 'sessions_create', { projectid: project.id, model: model, autoaccept: !!opt['auto-accept'] });
		var types = {};

		status = await new Promise(function(resolve) {

			var ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/', { headers: token ? { 'x-token': token } : {} });
			var line = false;

			var finish = code => {
				if (line)
					process.stdout.write('\n');
				resolve(code);
				try {
					ws.close();
				} catch (e) {}
			};

			ws.onerror = () => {
				console.error('The event connection failed');
				finish(1);
			};

			ws.onopen = function() {
				ws.send(JSON.stringify({ type: 'subscribe', sessionid: session.id }));
				setTimeout(() => request(url, token, 'sessions_prompt/' + session.id, { text: prompt }).catch(function(err) {
					console.error(err.message);
					finish(1);
				}), 100);
			};

			ws.onmessage = function(e) {

				var msg = JSON.parse(e.data);
				var data = msg.data;

				if (msg.sessionid !== session.id)
					return;

				if (msg.type === 'part.created')
					types[data.part.id] = data.part.type;

				if (msg.type === 'part.delta' && types[data.partid] === 'text') {
					process.stdout.write(data.text);
					line = true;
				}

				if (msg.type === 'part.updated' && data.part.type === 'tool' && (data.part.data.status === 'done' || data.part.data.status === 'error' || data.part.data.status === 'denied')) {
					console.error((line ? '\n' : '') + '[' + data.part.data.tool + '] ' + data.part.data.status + ' ' + JSON.stringify(data.part.data.input).substring(0, 100));
					line = false;
				}

				if (msg.type === 'permission.ask') {
					var allow = opt.yes === true;
					console.error((line ? '\n' : '') + '[permission] ' + data.tool + ' ' + (data.patterns[0] || '') + ' -> ' + (allow ? 'allowed once' : 'rejected (use --yes or --auto-accept)'));
					line = false;
					request(url, token, 'permissions_reply/' + data.id, { reply: allow ? 'once' : 'reject' }).catch(() => {});
				}

				if (msg.type === 'question.ask') {
					console.error('[question] ' + data.text + ' -> no user available');
					request(url, token, 'questions_reply/' + data.id, { answer: '(no user is available to answer: decide yourself)' }).catch(() => {});
				}

				if (msg.type === 'error')
					console.error((line ? '\n' : '') + 'error: ' + data.message + (data.retry ? ' (retrying)' : ''));

				if (msg.type === 'session.status' && data.status !== 'running')
					finish(data.status === 'idle' ? 0 : 1);
			};
		});

	} catch (err) {
		console.error(err.message);
		status = 1;
	}

	server && server.stop();
	return status;
}

async function main() {

	var args = process.argv.slice(2);
	var opt = options(args);
	var command = opt._[0];

	if (opt.help || command === 'help' || args.indexOf('-h') !== -1) {
		usage();
		return 0;
	}

	if (command === 'config') {
		console.log('Application: ' + ROOT);
		console.log('Config file: ' + Path.join(ROOT, 'config'));
		console.log('Data folder: ' + (datafolder(opt) || Path.join(ROOT, 'databases')));
		return 0;
	}

	if (command === 'run')
		return await run(opt);

	if (command === 'serve' || !command) {
		var port = parseInt(opt._[1] || '8000');
		var server = serve(port, false, datafolder(opt));
		if (!command) {
			var url = 'http://127.0.0.1:' + port + '/';
			if (await waitfor(url))
				open(url);
		}
		await new Promise(resolve => server.child.on('exit', resolve));
		return 0;
	}

	console.error('Unknown command: ' + command);
	usage();
	return 2;
}

if (require.main === module) {
	main().then(code => process.exit(code), function(err) {
		console.error(err.message);
		process.exit(1);
	});
}
