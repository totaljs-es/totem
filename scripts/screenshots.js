#!/usr/bin/env node
'use strict';

// Takes the screenshots of the website (img/shots) from a real Totem in a temporary data folder, with a demo project that is made up (a small Total.js
// tickets application). The answer about Total.js is a real model (Ollama with qwen2.5:1.5b, 986 MB); the edits, the permissions, the worktree and the
// terminal come from a scripted demo model ("demo-agent"), so that a screenshot comes out the same every time
// it is taken. The files of the application built in small tasks come from it too; its plan, its tasks, its checks and the application
// that starts are the real ones. Needs Google Chrome. A tooling script that runs with plain Node.js 22 or newer: it is not part of the application.
//
//   node scripts/screenshots.js --app ../totem [--model ollama:qwen2.5:1.5b] [--out img/shots]
//
// --app is the folder of the application (the branch main): this branch only has the website.
//
// Chrome is driven through its debugging protocol (no dependencies): it opens Totem in a window of 1440 x 900, twice the pixels, light and dark.

var Child = require('child_process');
var Fs = require('fs');
var Net = require('net');
var Os = require('os');
var Path = require('path');

var SITE = Path.join(__dirname, '..');
var CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

var ROOT = null;

function options(args) {
	var opt = {};
	for (var i = 0; i < args.length; i++) {
		if (args[i].startsWith('--'))
			opt[args[i].substring(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
	}
	return opt;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
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

async function until(fn, ms) {
	var started = Date.now();
	while (Date.now() - started < (ms || 30000)) {
		var value = await fn();
		if (value)
			return value;
		await sleep(250);
	}
	return null;
}

// ---- The demo project: made up, small, a Total.js application ---------------------------------------------------------

function demo(dir) {

	var files = {
		'package.json': JSON.stringify({ name: 'tickets', version: '1.0.0', description: 'A small tickets application', dependencies: { total5: '>=0.0.20-2' } }, null, '\t') + '\n',
		'index.js': "require('total5');\n\nvar options = {};\nF.run(options);\n",
		'config': 'name                : Tickets\nversion             : 1.0.0\n',
		'controllers/api.js': "exports.install = function() {\n\tROUTE('+API ? -tickets --> Tickets|list');\n\tROUTE('+API ? +tickets_create --> Tickets|create');\n};\n",
		'actions/tickets.js': "NEWACTION('Tickets|list', {\n\tname: 'List tickets',\n\taction: async function($) {\n\t\tvar items = await NOSQL('tickets').find().promise($);\n\t\t$.callback(items);\n\t}\n});\n\nNEWACTION('Tickets|create', {\n\tname: 'Create a ticket',\n\tinput: '*name:String, note:String',\n\taction: async function($, model) {\n\t\tmodel.id = UID();\n\t\tmodel.dtcreated = NOW;\n\t\tawait NOSQL('tickets').insert(model).promise($);\n\t\t$.success(model.id);\n\t}\n});\n",
		'views/index.html': '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<title>@{config.name}</title>\n</head>\n<body>\n\t<h1>@{config.name}</h1>\n</body>\n</html>\n',
		'README.md': '# Tickets\n\nA small tickets application made with Total.js 5.\n'
	};

	Object.keys(files).forEach(function(name) {
		var file = Path.join(dir, name);
		Fs.mkdirSync(Path.dirname(file), { recursive: true });
		Fs.writeFileSync(file, files[name]);
	});

	var git = args => Child.execFileSync('git', ['-c', 'user.email=demo@example.com', '-c', 'user.name=Demo'].concat(args), { cwd: dir, stdio: 'pipe' });
	git(['init', '-q', '-b', 'main']);
	git(['add', '.']);
	git(['commit', '-q', '-m', 'A small tickets application']);
}

// ---- Totem --------------------------------------------------------------------------------------------------------

function Totem(url) {
	this.url = url;
}

Totem.prototype.call = async function(schema, data) {
	var res = await fetch(this.url + '/api/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: schema, data: data || {} }) });
	var json = await res.json();
	if (Array.isArray(json) && json[0] && json[0].error)
		throw new Error(schema + ': ' + json[0].error);
	return json;
};

// Sends a prompt and waits until the session is idle again. `answer(event)` decides what happens with a permission or a question: it returns
// 'once' or 'reject' (or an answer for a question), or null to leave it waiting (the screenshot of a question is taken like that).
Totem.prototype.ask = async function(sessionid, text, extra, timeout, answer) {

	var self = this;
	var events = [];
	var ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/api/');

	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	ws.send(JSON.stringify({ type: 'subscribe', sessionid: sessionid }));

	ws.onmessage = function(event) {

		var message = JSON.parse(event.data);

		if (message.sessionid !== sessionid)
			return;

		events.push(message);

		if (message.type === 'permission.ask') {
			var reply = answer ? answer(message.data) : 'once';
			reply && self.call('permissions_reply/' + message.data.id, { reply: reply }).catch(() => {});
		}

		if (message.type === 'question.ask') {
			var text = answer ? answer(message.data) : '(decide yourself)';
			text && self.call('questions_reply/' + message.data.id, { answer: text }).catch(() => {});
		}
	};

	await this.call('sessions_prompt/' + sessionid, Object.assign({ text: text }, extra || {}));

	// It is over when the session was seen running and then stopped running (what is read before it starts is not the end)
	var ended = await until(async function() {
		var running = events.some(e => e.type === 'session.status' && e.data.status === 'running');
		var last = events.filter(e => e.type === 'session.status').pop();
		return running && last && last.data.status !== 'running' ? last : null;
	}, (timeout || 240) * 1000);

	var session = ended ? await self.call('sessions_read/' + sessionid) : null;

	ws.close();
	return { session: session, events: events };
};

// ---- Chrome -----------------------------------------------------------------------------------------------------------

async function chrome(profile, port) {

	var child = Child.spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', detached: true });

	var target = await until(async function() {
		try {
			var list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
			return list.find(item => item.type === 'page');
		} catch (e) {
			return null;
		}
	}, 20000);

	if (!target)
		throw new Error('Chrome did not start');

	var ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

	var id = 0;
	var waiting = {};

	ws.onmessage = function(event) {
		var message = JSON.parse(event.data);
		if (message.id && waiting[message.id]) {
			waiting[message.id](message);
			delete waiting[message.id];
		}
	};

	var api = {
		send: function(method, params) {
			return new Promise(function(resolve, reject) {
				var current = ++id;
				waiting[current] = message => message.error ? reject(new Error(method + ': ' + message.error.message)) : resolve(message.result);
				ws.send(JSON.stringify({ id: current, method: method, params: params || {} }));
			});
		},
		eval: async function(code) {
			var result = await api.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
			if (result.exceptionDetails)
				throw new Error('The page said: ' + (result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text));
			return result.result.value;
		},
		close: function() {
			try {
				ws.close();
			} catch (e) {}
			try {
				process.kill(-child.pid);
			} catch (e) {}
		}
	};

	await api.send('Page.enable');
	await api.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
	return api;
}

// ---- The scripted model: an OpenAI-compatible server that answers the demo conversations --------------------------------

// The conversations of the demo, chosen by a word of the prompt. A step is a tool call or the text of the answer.
var SCRIPTS = [
	{ match: /ping/i, steps: [
		{ tool: 'read', input: { path: 'controllers/api.js' } },
		{ tool: 'edit', input: { path: 'controllers/api.js', oldstring: "\tROUTE('+API ? +tickets_create --> Tickets|create');\n", newstring: "\tROUTE('+API ? +tickets_create --> Tickets|create');\n\tROUTE('GET /ping', ping);\n" } },
		{ tool: 'edit', input: { path: 'controllers/api.js', oldstring: '};\n', newstring: "};\n\nfunction ping($) {\n\t$.plain('pong');\n}\n" } },
		{ text: 'Done. `GET /ping` answers `pong`: the route is in `exports.install` and the function is below it, in `controllers/api.js`.' }
	] },
	{ match: /health/i, steps: [
		{ tool: 'edit', input: { path: 'controllers/api.js', oldstring: "\tROUTE('+API ? -tickets --> Tickets|list');\n", newstring: "\tROUTE('+API ? -tickets --> Tickets|list');\n\tROUTE('GET /health', health);\n" } },
		{ text: 'Added the route `GET /health`.' }
	] },
	{ match: /version/i, steps: [
		{ tool: 'edit', input: { path: 'controllers/api.js', oldstring: "\tROUTE('+API ? -tickets --> Tickets|list');\n", newstring: "\tROUTE('+API ? -tickets --> Tickets|list');\n\tROUTE('GET /version', version);\n" } },
		{ tool: 'edit', input: { path: 'controllers/api.js', oldstring: '};\n', newstring: "};\n\nfunction version($) {\n\t$.json({ version: CONF.version });\n}\n" } },
		{ text: 'Done: `GET /version` answers `{ "version": "1.0.0" }`. It is in its own branch: merge it when you like it.' }
	] },
	{ match: /commits/i, steps: [
		{ tool: 'bash', input: { command: 'git log --oneline -3' } },
		{ text: 'The project has one commit: `A small tickets application`.' }
	] }
];

function scripted(port) {

	var Http = require('http');

	function chunk(res, delta, finish) {
		res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: delta, finish_reason: finish || null }] }) + '\n\n');
	}

	return new Promise(function(resolve) {

		var server = Http.createServer(function(req, res) {

			var body = '';
			req.on('data', data => body += data);
			req.on('end', function() {

				if (!/chat\/completions/.test(req.url)) {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ data: [{ id: 'demo-agent' }] }));
					return;
				}

				var payload = JSON.parse(body);
				var messages = payload.messages || [];
				var last = -1;

				for (var i = messages.length - 1; i >= 0 && last === -1; i--) {
					if (messages[i].role === 'user')
						last = i;
				}

				var prompt = typeof(messages[last].content) === 'string' ? messages[last].content : JSON.stringify(messages[last].content);
				var script = SCRIPTS.find(item => item.match.test(prompt));
				var done = messages.slice(last + 1).filter(m => m.role === 'tool').length;
				var step = script && script.steps[Math.min(done, script.steps.length - 1)];

				// A task of a project: the file of the plugin "tasks" that comes in the prompt, with the names of this plugin
				var task = prompt.match(/Write ONE file with the write tool: `(plugins\/([a-z]+)\/[^`]+)`/);
				if (task) {
					var reference = prompt.match(/```(?:js|html)\n([^]*?)\n```/);
					var plural = task[2];
					var single = plural.replace(/s$/, '');
					var cap = text => text.charAt(0).toUpperCase() + text.substring(1);
					var content = reference[1].replace(/Tasks/g, cap(plural)).replace(/tasks/g, plural).replace(/Task/g, cap(single)).replace(/task/g, single) + '\n';
					step = done ? { text: 'Done.' } : { tool: 'write', input: { path: task[1], content: content } };
				}

				res.writeHead(200, { 'content-type': 'text/event-stream' });

				if (!step)
					step = { text: 'This is the demo model: it only answers the demo conversations.' };

				if (step.tool) {
					chunk(res, { tool_calls: [{ index: 0, id: 'call_' + done, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.input) } }] });
					chunk(res, {}, 'tool_calls');
				} else {
					step.text.split(' ').forEach((word, index) => chunk(res, { content: (index ? ' ' : '') + word }));
					chunk(res, {}, 'stop');
				}

				res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 800 + done * 120, completion_tokens: 60, total_tokens: 860 + done * 120 } }) + '\n\n');
				res.end('data: [DONE]\n\n');
			});
		});

		server.listen(port, '127.0.0.1', () => resolve(server));
	});
}

// ---- The screenshots --------------------------------------------------------------------------------------------------

async function main() {

	var opt = options(process.argv.slice(2));
	ROOT = Path.resolve(opt.app && opt.app !== true ? opt.app : Path.join(SITE, '..', 'totem'));

	if (!Fs.existsSync(Path.join(ROOT, 'index.js'))) {
		console.error('The application is not in ' + ROOT + '. Use: node scripts/screenshots.js --app <the folder of the branch main>');
		return 1;
	}

	var out = Path.resolve(SITE, opt.out && opt.out !== true ? opt.out : 'img/shots');
	var realmodel = opt.model && opt.model !== true ? opt.model : 'ollama:qwen2.5:1.5b';

	if (!Fs.existsSync(CHROME)) {
		console.error('Google Chrome is needed (set CHROME_PATH if it is somewhere else).');
		return 1;
	}

	Fs.mkdirSync(out, { recursive: true });

	var base = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totem-shots-'));
	var data = Path.join(base, 'data');
	var project = Path.join(base, 'projects', 'tickets');
	var profile = Path.join(base, 'chrome');
	[data, Path.join(base, 'projects'), project, profile].forEach(dir => Fs.mkdirSync(dir));
	demo(project);

	var started = [];
	var browser = null;

	try {

		var mockport = await freeport();
		var mock = await scripted(mockport);
		var port = await freeport();
		// A plain shell for the terminal: the one of a person has a prompt and a banner with the name of the user and of the computer, which do not go in a screenshot
		var server = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port), '--release', '--data', data], { cwd: ROOT, stdio: 'ignore', detached: true, env: Object.assign({}, process.env, { SHELL: '/bin/sh' }) });
		started.push(() => { try { process.kill(-server.pid); } catch (e) {} });
		started.push(() => mock.close());

		var totem = new Totem('http://127.0.0.1:' + port);

		if (!await until(async () => { try { await totem.call('account'); return true; } catch (e) { return false; } }, 30000))
			throw new Error('Totem did not start');

		// The real model (Ollama on this computer) and the demo one
		var found = (await totem.call('providers_detect')).find(item => item.template.id === realmodel.split(':')[0]);
		var realid = realmodel.substring(realmodel.indexOf(':') + 1);
		var wanted = found && found.models.filter(item => item.id === realid);

		if (!wanted || !wanted.length)
			throw new Error('The model ' + realmodel + ' is not on this computer (is Ollama running?)');

		var meta = {};
		wanted.forEach(item => meta[item.id] = item);
		await totem.call('providers_save', { name: found.template.name, url: found.template.url, kind: found.template.kind, icon: found.template.icon, models: wanted.map(item => item.id), meta: meta });
		await totem.call('providers_save', { name: 'Local', url: 'http://127.0.0.1:' + mockport + '/v1', kind: 'openai', icon: '', models: ['demo-agent'], meta: { 'demo-agent': { id: 'demo-agent', tools: true } } });

		var models = await totem.call('providers_models');
		var real = models.find(id => id === realmodel);
		var demomodel = models.find(id => /demo-agent/.test(id));

		if (!real || !demomodel)
			throw new Error('The models are not there: ' + models.join(', '));

		var proj = await totem.call('projects_open', { path: project });
		var allow = event => (event.tool === 'mcp-start' ? 'once' : (event.tool ? 'once' : '(decide yourself)'));

		// 1. The answer of a real model, with the knowledge of Totem
		console.log('The real model answers (' + real + ')...');
		var chat = null;

		for (var attempt = 0; attempt < 8 && !chat; attempt++) {

			var session = await totem.call('sessions_create', { projectid: proj.id, model: real, name: 'An API for the tickets' });
			var answered = await totem.ask(session.id, 'Create an API route and its action that lists tickets.', { mode: 'plan' }, 240, allow);
			var messages = await totem.call('sessions_messages/' + session.id);
			var text = messages.filter(m => m.role === 'assistant').map(m => m.parts.filter(p => p.type === 'text').map(p => p.data.text).join('\n')).join('\n');

			// Good enough to be shown: an action with a pipe name, its route, tabs, and nothing of the interface
			var missing = [];
			!/NEWACTION\(\s*'[A-Za-z]+\|[a-z]+'/.test(text) && missing.push('an action with a pipe name');
			!/ROUTE\(/.test(text) && missing.push('a route');
			/^ {2,}\S/m.test(text.replace(/[^]*?```js/, '')) && missing.push('tabs (it used spaces)');
			/COMPONENT\(|ui-component/.test(text) && missing.push('no interface');
			/npm (run|test)|yarn |express|schemas\/|\.json`/i.test(text) && missing.push('no invented command, file or other framework');

			if (!missing.length)
				chat = session;
			else {
				console.log('  that answer was not good enough to show (attempt ' + (attempt + 1) + '): it lacks ' + missing.join(', ') + (opt.debug ? '\n' + text.substring(0, 700) : ''));
				await totem.call('sessions_remove/' + session.id);
			}
		}

		if (!chat)
			throw new Error('The real model did not give an answer good enough to show');

		// 2. An edit that was approved: the diff
		console.log('The edit with its diff...');
		var edit = await totem.call('sessions_create', { projectid: proj.id, model: demomodel, name: 'A ping route' });
		await totem.ask(edit.id, 'Add a route GET /ping that answers pong.', { mode: 'build' }, 120, allow);

		// 3. The commands of the agent and the shell
		var shell = await totem.call('sessions_create', { projectid: proj.id, model: demomodel, name: 'The last commits' });
		await totem.ask(shell.id, 'Show me the last commits.', { mode: 'build' }, 120, allow);

		// 4. A worktree: the work in its own branch
		var tree = await totem.call('sessions_create', { projectid: proj.id, model: demomodel, name: 'A version route', worktree: true, autoaccept: true });
		await totem.ask(tree.id, 'Add a route GET /version.', { mode: 'build' }, 120, allow);

		// 5. A question that waits for the person: the permission to change a file
		var waiting = await totem.call('sessions_create', { projectid: proj.id, model: demomodel, name: 'A health route' });
		// Forge may start; the change of the file is left waiting for the person
		await totem.ask(waiting.id, 'Add a route GET /health.', { mode: 'build' }, 20, event => event.tool === 'mcp-start' ? 'once' : null);

		// 6. A whole application in small tasks: the card, the plan and the build, in an empty folder
		console.log('An application in small tasks...');
		var helpdesk = Path.join(base, 'projects', 'helpdesk');
		Fs.mkdirSync(helpdesk);
		var proj2 = await totem.call('projects_open', { path: helpdesk });
		var build = await totem.call('sessions_create', { projectid: proj2.id, model: demomodel, name: 'A helpdesk in small tasks', autoaccept: true });
		await totem.ask(build.id, '/project APP: Helpdesk\nPLUGIN: tickets\nTITLE: Tickets\nICON: ti ti-check-circle\nFIELDS: *name:String, note:String\nPLUGIN: customers\nTITLE: Customers\nICON: ti ti-building\nFIELDS: *name:String, note:String', { mode: 'build' }, 60, allow);
		await totem.ask(build.id, '/build', { mode: 'build' }, 240, allow);

		var plan = JSON.parse(Fs.readFileSync(Path.join(helpdesk, '.totem', 'project.json'), 'utf8'));
		var notdone = plan.tasks.filter(item => item.status !== 'done');
		if (notdone.length)
			throw new Error('The application was not built: ' + notdone.map(item => item.path + ' ' + (item.problem || item.status)).join('; '));

		// The application that was built, started as a person would (with the Total.js of Totem instead of npm install)
		Fs.symlinkSync(Path.join(ROOT, 'node_modules'), Path.join(helpdesk, 'node_modules'));
		var appport = await freeport();
		var app = Child.spawn(process.execPath, ['index.js', String(appport)], { cwd: helpdesk, stdio: 'ignore', detached: true });
		started.push(() => { try { process.kill(-app.pid); } catch (e) {} });
		var appurl = 'http://127.0.0.1:' + appport;
		var save = (schema, data) => fetch(appurl + '/api/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: schema, data: data }) }).then(res => res.json());

		if (!await until(async () => { try { return (await fetch(appurl + '/')).status === 200; } catch (e) { return false; } }, 30000))
			throw new Error('The application that was built did not start');

		for (var ticket of [['The invoice of October has the wrong address', 'Asked by phone'], ['Cannot sign in from the new laptop', ''], ['Export of the orders as CSV', 'For the accounting team'], ['A second user for the warehouse', '']]) {
			var saved = await save('tickets_save', { name: ticket[0], note: ticket[1] });
			if (!saved || saved.success !== true)
				throw new Error('The application that was built did not save a ticket: ' + JSON.stringify(saved));
		}

		// Two scheduled prompts
		await totem.call('schedules_save', { projectid: proj.id, name: 'Morning review', text: 'Review the project and list what is wrong.', model: real, kind: 'daily', time: '07:30', mode: 'plan' });
		await totem.call('schedules_save', { projectid: proj.id, name: 'Look for old dependencies', text: 'List the dependencies that are out of date.', model: real, kind: 'interval', interval: 1440, mode: 'plan' });

		// The permission is waiting for an answer: wait for its event through the page itself
		browser = await chrome(profile, await freeport());
		started.push(() => browser.close());

		async function shot(name, theme, prepare, url) {
			await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
			await browser.send('Page.navigate', { url: url || (totem.url + '/') });
			await sleep(2500);
			!url && await browser.eval("THEME.apply('" + theme + "'); 1");
			prepare && await browser.eval(prepare);
			await sleep(2200);
			// The screenshots show the interface, not a model: the selector of the prompt reads "Local model"
			!url && await browser.eval("(function() { var box = document.querySelector('.model'); if (!box) return 0; box.querySelectorAll('input').forEach(function(el) { el.value = 'Local model'; }); var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); var node; while ((node = walker.nextNode())) { if (/[a-z0-9]:[a-z0-9]/i.test(node.nodeValue)) node.nodeValue = 'Local model'; } return 1; })()");
			var result = await browser.send('Page.captureScreenshot', { format: 'webp', quality: 88 });
			var file = Path.join(out, name + '-' + theme + '.webp');
			Fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
			console.log('  ' + Path.relative(process.cwd(), file) + ' (' + Math.round(Fs.statSync(file).size / 1024) + ' kB)');
		}

		var open = id => "PLUGINS.projects.session('" + id + "', '" + proj.id + "'); 1";

		console.log('Screenshots...');

		// The shell of the session, with a couple of commands typed
		await totem.call('sessions_terminal/' + shell.id, { start: true, columns: 48, rows: 20 });
		await sleep(800);
		for (var line of ['git log --oneline', 'ls', 'git status -sb'])
			await totem.call('sessions_terminalinput/' + shell.id, { data: Buffer.from(line + '\n').toString('base64') }), await sleep(500);
		for (var theme of ['light', 'dark']) {
			await shot('chat', theme, open(chat.id));
			await shot('changes', theme, open(edit.id) + '; PLUGINS.chat.changes(); 1');
			await shot('permission', theme, open(waiting.id));
			await shot('terminal', theme, open(shell.id) + '; PLUGINS.chat.terminal(); 1');
			await shot('worktree', theme, open(tree.id) + '; PLUGINS.chat.changes(); 1');
			await shot('schedules', theme, open(chat.id) + '; PLUGINS.projects.schedules(); 1');
			await shot('settings', theme, open(chat.id) + '; PLUGINS.projects.settings(); 1');
			await shot('agents', theme, open(chat.id) + '; PLUGINS.chat.agents(); 1');
			await shot('project', theme, "PLUGINS.projects.session('" + build.id + "', '" + proj2.id + "'); 1");
			await shot('built', theme, '', appurl + '/');
		}

		console.log('Done.');
		return 0;

	} finally {
		started.reverse().forEach(stop => stop());
		await sleep(800);
		Fs.rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
	}
}

main().then(code => process.exit(code), function(err) {
	console.error(err.message);
	process.exit(1);
});
