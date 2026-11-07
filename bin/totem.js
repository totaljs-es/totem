#!/usr/bin/env node
'use strict';

// The totem command. It is a tooling script that runs with plain Node.js 22 or newer: it is not part of the Total.js application.
//
//   totem [port]                  starts the server in the background, opens the browser and gives the terminal back (8000, or totem 4524)
//   totem start [port]            the same, without opening the browser
//   totem stop                    stops the server that `totem` started
//   totem status                  says if it runs
//   totem serve [port]            runs the server in this terminal until Ctrl+C (default port 8000)
//   totem run "prompt" [options]  runs one prompt without the interface and prints what happens
//   totem config                  prints the folders that Totem uses
//   totem --help
//
// Options of run: --project <folder> (default: the current folder), --model <provider:model>, --url <server> (default: a temporary
// local server), --token <token>, --auto-accept (edits run without asking), --yes (every question is answered "allow once").

var Child = require('child_process');
var Fs = require('fs');
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

// Installed from npm (not a clone): the application runs without the watcher, which writes files next to index.js and restarts the server when a file changes.
// Both are for the development of Totem, not for using it, and the folder of an installed package can be read only.
function installed() {
	return Path.relative(ROOT, __dirname) === 'bin' && ROOT.split(Path.sep).indexOf('node_modules') !== -1;
}

exports.installed = installed;

function usage() {
	console.log([
		'Usage:',
		'  totem [port]                  start the server in the background and open the browser (port: 8000, or for example totem 4524)',
		'  totem start [port]            the same, without opening the browser (also --port 4524)',
		'  totem stop                    stop the server that totem started',
		'  totem status                  say if it runs, and where',
		'  totem serve [port]            run the server in this terminal until Ctrl+C (default port 8000)',
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
		'  --data <folder>      where the data goes (installed from npm: a folder of your user)',
		'  --verbose            show the whole output of the server'
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

// Why the server did not start, in a sentence, from what it printed
function explain(output, port) {

	if (/EADDRINUSE|address already in use/i.test(output))
		return 'The port ' + port + ' is already in use (is Totem already running?). Open http://127.0.0.1:' + port + ' or start another one with: totem serve ' + (port + 1);

	if (/EACCES|permission denied/i.test(output))
		return 'The server has no permission to use the port ' + port + ' or to write its data. Try another port (totem serve 8001) or a data folder of yours (totem --data <folder>).';

	if (/Cannot find module/i.test(output))
		return 'A file of the installation is missing. Install Totem again (npm install -g totaljs-totem).';

	var lines = output.split('\n').map(line => line.trim()).filter(line => /error/i.test(line)).slice(-3);
	return lines.length ? lines.join('\n') : 'The server stopped before it answered.';
}

exports.explain = explain;

// Is something listening on the port?
function busy(port) {
	return new Promise(function(resolve) {
		var socket = Net.connect({ host: '127.0.0.1', port: port });
		socket.setTimeout(800);
		socket.on('connect', () => (socket.destroy(), resolve(true)));
		socket.on('timeout', () => (socket.destroy(), resolve(false)));
		socket.on('error', () => resolve(false));
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

function serve(port, quiet, data, capture) {
	var child = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port)].concat(installed() ? ['--release'] : []).concat(data ? ['--data', data] : []), { cwd: ROOT, stdio: capture ? ['ignore', 'pipe', 'pipe'] : (quiet ? 'ignore' : 'inherit'), detached: true });
	var output = '';

	// The output of the server is kept (the end of it) to say why it failed; with --verbose it is shown as it comes
	if (capture) {
		var keep = function(chunk) {
			output = (output + chunk.toString('utf8')).slice(-20000);
			capture === 'show' && process.stdout.write(chunk);
		};
		child.stdout.on('data', keep);
		child.stderr.on('data', keep);
	}

	var stop = function() {
		try {
			process.kill(-child.pid);
		} catch (e) {}
	};
	process.on('exit', stop);
	process.on('SIGINT', () => process.exit(130));
	process.on('SIGTERM', () => process.exit(143));
	return { child: child, stop: stop, output: () => output };
}

async function waitfor(url, token, tries) {
	for (var i = 0; i < (tries || 100); i++) {
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

// The port: `totem 4524`, `totem start 4524`, `totem serve 4524` or `--port 4524`. 8000 without one. Returns 0 when it is not a port.
function portof(opt, fallback) {
	var value = opt._[1] || (opt.port && opt.port !== true ? opt.port : '') || fallback || '8000';
	var port = /^\d+$/.test(String(value)) ? parseInt(value) : 0;
	return port >= 1 && port <= 65535 ? port : 0;
}

exports.portof = portof;

// The state of the server that `totem` starts in the background: its process, its port and its log, in the data folder
function statefile(data) {
	return Path.join(data || Path.join(ROOT, 'databases'), 'totem-server.json');
}

function readstate(data) {
	try {
		return JSON.parse(Fs.readFileSync(statefile(data), 'utf8'));
	} catch (e) {
		return null;
	}
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

// The banner of the framework: what the server printed until it said where it listens
function banner(output) {
	var lines = output.split('\n');
	var end = lines.findIndex(line => /^https?:\/\//.test(line.trim()));
	return (end === -1 ? lines.slice(0, 25) : lines.slice(0, end + 1)).join('\n').trim();
}

// The server prints its banner a moment after it answers: wait for the line that says where it listens (not for long)
async function waitbanner(read) {
	for (var i = 0; i < 20 && !/^https?:\/\//m.test(read()); i++)
		await new Promise(resolve => setTimeout(resolve, 100));
	return read();
}

async function waitready(url, isdead) {
	for (var i = 0; i < 200; i++) {
		if (isdead())
			return false;
		if (await waitfor(url, '', 1))
			return true;
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	return false;
}

function message(url, port, data) {
	console.log('Total.js Totem ' + require(Path.join(ROOT, 'package.json')).version + ' is ready');
	console.log('  Open:  ' + url + '  (or http://localhost:' + port + '/)');
	console.log('  Data:  ' + (data || Path.join(ROOT, 'databases')));
}

// The port is taken: by a Totem that runs already, or by another program. Returns the exit code, or null when the port is free.
async function taken(port, url, open_) {

	if (!await busy(port))
		return null;

	if (await waitfor(url, '', 3)) {
		console.log('Totem is already running: ' + url + (open_ ? '' : ''));
		open_ && open(url);
		return 0;
	}

	console.error('The port ' + port + ' is used by another program. Start Totem on another port: totem start ' + (port + 1));
	return 1;
}

// In the background: the terminal is given back
async function start(opt, show) {

	var port = portof(opt);

	if (!port) {
		console.error('That is not a port: use a number from 1 to 65535, for example: totem 4524');
		return 2;
	}

	var data = datafolder(opt);
	var url = 'http://127.0.0.1:' + port + '/';
	var busycode = await taken(port, url, show);

	if (busycode !== null)
		return busycode;

	var file = statefile(data);
	var log = Path.join(Path.dirname(file), 'totem.log');
	Fs.mkdirSync(Path.dirname(file), { recursive: true });

	var fd = Fs.openSync(log, 'w');
	var child = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port)].concat(installed() ? ['--release'] : []).concat(data ? ['--data', data] : []), { cwd: ROOT, stdio: ['ignore', fd, fd], detached: true });
	var exited = false;

	child.on('exit', () => exited = true);
	child.unref();
	Fs.closeSync(fd);
	Fs.writeFileSync(file, JSON.stringify({ pid: child.pid, port: port, url: url, log: log, started: new Date().toISOString() }));

	var ready = await waitready(url, () => exited);
	var readlog = function() {
		try {
			return Fs.readFileSync(log, 'utf8');
		} catch (e) {
			return '';
		}
	};
	var output = ready ? await waitbanner(readlog) : readlog();

	if (!ready) {
		console.error('Totem could not start.\n' + explain(output, port) + '\nThe whole output of the server is in ' + log);
		try {
			process.kill(-child.pid);
		} catch (e) {}
		Fs.rmSync(file, { force: true });
		return 1;
	}

	var shown = banner(output);
	shown && console.log(shown + '\n');
	message(url, port, data);
	console.log('  Log:   ' + log);
	console.log('  It keeps running in the background. Stop it with: totem stop');
	show && open(url);
	return 0;
}

async function stop(opt) {

	var data = datafolder(opt);
	var state = readstate(data);

	if (!state || !alive(state.pid)) {
		Fs.rmSync(statefile(data), { force: true });
		var port = portof(opt) || 8000;
		if (await busy(port) && await waitfor('http://127.0.0.1:' + port + '/', '', 2))
			console.log('A Totem answers on port ' + port + ' but it was not started by `totem` (it runs in a terminal: stop it there with Ctrl+C).');
		else
			console.log('Totem is not running.');
		return 0;
	}

	try {
		process.kill(-state.pid, 'SIGTERM');
	} catch (e) {
		try {
			process.kill(state.pid, 'SIGTERM');
		} catch (e2) {}
	}

	for (var i = 0; i < 50 && alive(state.pid); i++)
		await new Promise(resolve => setTimeout(resolve, 100));

	if (alive(state.pid)) {
		try {
			process.kill(-state.pid, 'SIGKILL');
		} catch (e) {}
	}

	Fs.rmSync(statefile(data), { force: true });
	console.log('Totem stopped (' + state.url + ').');
	return 0;
}

async function status(opt) {

	var data = datafolder(opt);
	var state = readstate(data);

	if (state && alive(state.pid) && await waitfor(state.url, '', 3)) {
		console.log('Totem is running: ' + state.url + '  (pid ' + state.pid + ', since ' + state.started + ')');
		console.log('  Log: ' + state.log);
		console.log('  Stop it with: totem stop');
		return 0;
	}

	console.log('Totem is not running. Start it with: totem');
	return 1;
}

async function main() {

	var args = process.argv.slice(2);
	var opt = options(args);
	var command = opt._[0];

	// `totem 4524` is `totem` on the port 4524
	if (/^\d+$/.test(command || '')) {
		opt._ = ['', command];
		command = '';
	}

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

	if (!command || command === 'start')
		return await start(opt, !command);

	if (command === 'stop')
		return await stop(opt);

	if (command === 'restart') {
		var before = readstate(datafolder(opt));
		!opt._[1] && !opt.port && before && before.port && (opt._[1] = String(before.port));
		await stop(opt);
		return await start(opt, false);
	}

	if (command === 'status')
		return await status(opt);

	// In this terminal until Ctrl+C: the banner of the framework, then where it listens (a server, a container, a developer)
	if (command === 'serve') {

		var port = portof(opt);

		if (!port) {
			console.error('That is not a port: use a number from 1 to 65535, for example: totem serve 4524');
			return 2;
		}

		var data = datafolder(opt);
		var url = 'http://127.0.0.1:' + port + '/';
		var busycode = await taken(port, url, false);

		if (busycode !== null)
			return busycode;

		var server = serve(port, false, data, opt.verbose ? 'show' : 'keep');
		var exited = false;

		server.child.on('exit', () => exited = true);

		if (!await waitready(url, () => exited)) {
			console.error('Totem could not start.\n' + explain(server.output(), port) + (opt.verbose ? '' : '\nRun it again with --verbose to see the whole output of the server.'));
			server.stop();
			return 1;
		}

		if (!opt.verbose) {
			var shown = banner(await waitbanner(() => server.output()));
			shown && console.log(shown + '\n');
		}

		message(url, port, data);
		console.log('  Press Ctrl+C to stop it.');

		var end = await new Promise(resolve => server.child.on('exit', (code, signal) => resolve({ code: code, signal: signal })));

		// Stopped by itself with an error: say why
		if (end.code) {
			console.error('Totem stopped.\n' + explain(server.output(), port));
			return 1;
		}

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
