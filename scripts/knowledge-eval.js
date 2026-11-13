#!/usr/bin/env node
'use strict';

// Evaluates how well a model answers with the knowledge that Totem gives it about Total.js 5 and jComponent 20 (the primer, the skill, the
// conventions). A tooling script that runs with plain Node.js 22 or newer: it is not part of the application.
//
//   node scripts/knowledge-eval.js --model ollama:qwen2.5:1.5b            every case once
//   node scripts/knowledge-eval.js --model ollama:qwen2.5:1.5b --runs 3   three times each: a small model does not answer the same way twice
//   node scripts/knowledge-eval.js --model <id> --filter route            only the cases whose id or topic contains "route"
//   node scripts/knowledge-eval.js --model <id> --out result.json         the answers and the verdicts as JSON (to read why a case failed)
//   node scripts/knowledge-eval.js --list                                 the cases
//
// Options: --url <server> (default: a temporary local server, which uses the providers of this installation), --token <token>,
// --cases <file> (default tests/knowledge/cases.json), --timeout <seconds per case> (default 240), --lenient,
// --reasoning <none|low|medium|high> (for models that support it),
// --no-forge (without the pages of Forge: the model only has the primer and the skill; by default Forge is allowed to start, as a person would allow it).
//
// The code that the model shows is checked too, not only the words: every fenced block in js or html goes through the conventions checker of
// Totem (private/conventions/check.js: syntax, tabs, ES5, `@(text)`, no require of Node.js modules, names with |...) and the capital letter functions of
// a server block must exist in Total.js 5 (an invented SEND_ALL() fails). A case with `code: "js"` or `code: "html"` must also show such a block.
// Style findings count too (the answer must be formatted as our conventions say); --lenient ignores them.
//
//   node scripts/knowledge-eval.js --rejudge result.json     scores the saved answers again with the current cases and checks, without the model
//
// Every case is a prompt in Plan mode, in a new session of a temporary Total.js project (so that Totem loads its Total.js knowledge, as in a real
// project). A case passes when every `must` expression matches the answer, no `mustnot` expression matches anywhere and no `mustnotcode`
// expression matches inside a fenced code block. The expressions are JavaScript regular expressions (case-sensitive). The script removes the
// sessions and the project that it created.

var Child = require('child_process');
var Fs = require('fs');
var Net = require('net');
var Os = require('os');
var Path = require('path');

var ROOT = Path.join(__dirname, '..');

function options(args) {
	var opt = { _: [] };
	for (var i = 0; i < args.length; i++) {
		if (args[i].startsWith('--')) {
			var key = args[i].substring(2);
			if (args[i + 1] === undefined || args[i + 1].startsWith('--'))
				opt[key] = true;
			else
				opt[key] = args[++i];
		} else
			opt._.push(args[i]);
	}
	return opt;
}

function request(url, token, schema, data) {
	return fetch(new URL('/api/', url), {
		method: 'POST',
		headers: Object.assign({ 'content-type': 'application/json' }, token ? { 'x-token': token } : {}),
		body: JSON.stringify({ schema: schema, data: data || {} })
	}).then(async function(res) {
		var text = await res.text();
		var json;
		try {
			json = JSON.parse(text);
		} catch (e) {
			throw new Error('Unexpected answer (' + res.status + ')');
		}
		if (Array.isArray(json) && json[0] && json[0].error)
			throw new Error(json[0].error);
		return json;
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

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


var CHECKER = require(Path.join(ROOT, 'private/conventions/check.js'));
var GLOBALS = null;

// The globals of Total.js 5 (capital letters), asked to the framework itself in a process of its own
function globals() {

	if (GLOBALS)
		return GLOBALS;

	var probe = Path.join(ROOT, '.eval-globals-probe.js');
	Fs.writeFileSync(probe, "require('total5'); console.log(JSON.stringify(Object.keys(global).filter(k => /^[A-Z][A-Za-z0-9_]*$/.test(k))));");

	try {
		var lines = Child.execFileSync(process.execPath, [probe], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
		GLOBALS = JSON.parse(lines[lines.length - 1]);
	} catch (e) {
		GLOBALS = [];
	} finally {
		Fs.rmSync(probe, { force: true });
	}

	return GLOBALS;
}

// The fenced blocks of an answer: [{ lang, code }]
function blocks(text) {
	var found = [];
	var regex = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
	var match;
	while ((match = regex.exec(text)))
		found.push({ lang: match[1].toLowerCase(), code: match[2].replace(/\s+$/, '') + '\n' });
	return found;
}

// The conventions of Totem and the existence of what the code calls. `dir` is a Total.js project (a package.json with total5) where the blocks are written.
function codecheck(text, dir, lenient, serial) {

	var reasons = [];
	var count = 0;

	blocks(text).forEach(function(block) {

		var js = block.lang === 'js' || block.lang === 'javascript';
		var html = block.lang === 'html';

		if (!js && !html)
			return;

		count++;

		// A sketch with an ellipsis is not code to run
		if (/^\s*(\.\.\.|…|\/\/\s*\.\.\.)\s*$/m.test(block.code))
			return;

		var folder = html ? 'plugins/eval/public' : 'actions';
		var file = Path.join(dir, folder, 'answer-' + serial + '-' + count + (html ? '.html' : '.js'));
		Fs.mkdirSync(Path.dirname(file), { recursive: true });
		Fs.writeFileSync(file, block.code);

		var findings = [];

		try {
			findings = CHECKER.file(file);
		} catch (e) {
			findings = [{ line: 0, rule: 'checker', severity: 'error', message: e.message }];
		}

		findings.forEach(function(item) {
			if (item.severity === 'style' && lenient)
				return;
			// The names of a file are not the model's: only the code counts
			if (item.rule === 'file-name')
				return;
			reasons.push('code ' + item.severity + ' ' + item.rule + ' (line ' + item.line + ')');
		});

		// A function of capital letters that Total.js 5 does not have
		if (js && /\b(NEWACTION|NEWSCHEMA|ROUTE|NOSQL|DATA|CRON|AUTH|FUNC|MAIN|MODS|RESTBuilder|UID|CONF)\b|exports\.install/.test(block.code) && !/\b(COMPONENT|PLUGIN|COMPONENTATOR|SETTER)\(/.test(block.code)) {
			var known = globals();
			var declared = {};
			(block.code.match(/\b(?:function|var|let|const)\s+([A-Z][A-Z0-9_]+)\b/g) || []).forEach(d => declared[d.split(/\s+/)[1]] = true);
			var seen = {};
			(block.code.match(/(^|[^.\w$])[A-Z][A-Z0-9_]{2,}\(/gm) || []).forEach(function(call) {
				var name = call.replace(/^[^A-Z]*/, '').replace('(', '');
				if (!seen[name] && known.length && known.indexOf(name) === -1 && !declared[name]) {
					seen[name] = true;
					reasons.push('code calls ' + name + '() that Total.js 5 does not have');
				}
			});
		}
	});

	return { reasons: reasons.filter((value, index, list) => list.indexOf(value) === index), blocks: count };
}

// The code of an answer: what is between ``` fences
function codeof(text) {
	var blocks = text.match(/```[\s\S]*?```/g) || [];
	return blocks.join('\n');
}

// { pass, reasons }
function judge(item, text, context) {

	var reasons = [];
	var code = codeof(text);

	(item.must || []).forEach(function(source) {
		if (!new RegExp(source).test(text))
			reasons.push('missing /' + source + '/');
	});

	(item.mustnot || []).forEach(function(source) {
		var match = text.match(new RegExp(source));
		if (match)
			reasons.push('has /' + source + '/ -> ' + match[0].substring(0, 40));
	});

	(item.mustnotcode || []).forEach(function(source) {
		var match = code.match(new RegExp(source));
		if (match)
			reasons.push('code has /' + source + '/ -> ' + match[0].substring(0, 40));
	});

	if (context) {

		var checked = codecheck(text, context.dir, context.lenient, context.serial++);
		reasons = reasons.concat(checked.reasons);

		if (item.code && !blocks(text).some(b => item.code === 'html' ? b.lang === 'html' : (b.lang === 'js' || b.lang === 'javascript')))
			reasons.push('no ' + item.code + ' code block');
	}

	return { pass: !reasons.length, reasons: reasons };
}

async function ask(url, token, sessionid, prompt, timeout, forge) {

	var types = {};

	return new Promise(function(resolve) {

		var ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/', { headers: token ? { 'x-token': token } : {} });
		var done = false;
		var tools = [];
		var knowledge = [];

		var finish = function(status) {
			if (done)
				return;
			done = true;
			clearTimeout(timer);
			try {
				ws.close();
			} catch (e) {}
			resolve({ status: status, tools: tools, knowledge: knowledge });
		};

		var timer = setTimeout(function() {
			request(url, token, 'sessions_abort/' + sessionid).catch(() => {});
			finish('timeout');
		}, timeout * 1000);

		ws.onerror = () => finish('connection');

		ws.onopen = function() {
			ws.send(JSON.stringify({ type: 'subscribe', sessionid: sessionid }));
			setTimeout(() => request(url, token, 'sessions_prompt/' + sessionid, { text: prompt, mode: 'plan' }).catch(() => finish('prompt')), 100);
		};

		ws.onmessage = function(e) {

			var msg = JSON.parse(e.data);
			var data = msg.data;

			if (msg.sessionid !== sessionid)
				return;

			if (msg.type === 'part.updated' && data.part.type === 'tool' && data.part.data.status !== 'running' && tools.indexOf(data.part.data.tool) === -1)
				tools.push(data.part.data.tool);

			// The pages of Forge that Totem put in front of the model
			if (msg.type === 'part.created' && data.part.type === 'knowledge')
				knowledge = knowledge.concat((data.part.data.pages || []).map(page => page.title));

			// Nobody is there: a permission is refused, except the start of Forge (the real knowledge of Totem comes from it) unless --no-forge
			if (msg.type === 'permission.ask') {
				var allow = forge && data.tool === 'mcp-start' && /^forge: /.test((data.patterns || [])[0] || '');
				request(url, token, 'permissions_reply/' + data.id, { reply: allow ? 'once' : 'reject' }).catch(() => {});
			}

			if (msg.type === 'question.ask')
				request(url, token, 'questions_reply/' + data.id, { answer: '(no user is available to answer: decide yourself)' }).catch(() => {});

			if (msg.type === 'session.status' && data.status !== 'running')
				finish(data.status);
		};
	});
}

async function answerof(url, token, sessionid) {
	var messages = await request(url, token, 'sessions_messages/' + sessionid);
	var text = [];
	var tokens = 0;
	messages.forEach(function(m) {
		if (m.role !== 'assistant')
			return;
		m.parts.forEach(function(p) {
			// After the check of the code the model answers again: the answer is the corrected one, not the first
			if (p.type === 'selfcheck')
				text.length = 0;
			if (p.type === 'text')
				text.push(p.data.text || '');
		});
	});
	return text.join('\n').trim();
}


function summary(model, results, runs, opt) {

	var total = results.reduce((sum, r) => sum + r.passed, 0);
	var all = results.reduce((sum, r) => sum + r.runs, 0);
	var topics = {};

	results.forEach(function(r) {
		topics[r.topic] = topics[r.topic] || { passed: 0, runs: 0 };
		topics[r.topic].passed += r.passed;
		topics[r.topic].runs += r.runs;
	});

	console.log('\nScore: ' + total + '/' + all + ' (' + Math.round(total * 100 / all) + '%)');
	console.log(Object.keys(topics).map(topic => topic + ' ' + topics[topic].passed + '/' + topics[topic].runs).join(' | '));

	if (opt.out && opt.out !== true)
		Fs.writeFileSync(Path.resolve(opt.out), JSON.stringify({ model: model, date: new Date().toISOString(), runs: runs, score: total, of: all, results: results }, null, '\t'));

	return total === all ? 0 : 1;
}

async function main() {

	var opt = options(process.argv.slice(2));
	var file = opt.cases && opt.cases !== true ? Path.resolve(opt.cases) : Path.join(ROOT, 'tests/knowledge/cases.json');
	var cases = JSON.parse(Fs.readFileSync(file, 'utf8'));

	if (opt.list) {
		cases.forEach(item => console.log(item.id.padEnd(22) + item.topic.padEnd(12) + item.prompt));
		return 0;
	}

	if (opt.filter && opt.filter !== true)
		cases = cases.filter(item => item.id.indexOf(opt.filter) !== -1 || item.topic.indexOf(opt.filter) !== -1);

	if (!cases.length) {
		console.error('No case matches.');
		return 2;
	}


	// The saved answers again, with the current cases and checks (no server, no model)
	if (opt.rejudge && opt.rejudge !== true) {

		var saved = JSON.parse(Fs.readFileSync(Path.resolve(opt.rejudge), 'utf8'));
		var rdir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totem-eval-'));
		Fs.writeFileSync(Path.join(rdir, 'package.json'), JSON.stringify({ name: 'eval', dependencies: { total5: '*' } }));
		var rcontext = { dir: rdir, lenient: !!opt.lenient, serial: 0 };
		var byid = {};
		cases.forEach(item => byid[item.id] = item);
		var rresults = [];

		saved.results.forEach(function(old) {

			var item = byid[old.id];
			if (!item)
				return;

			var passed = 0;
			var details = old.details.map(function(run) {
				var verdict = judge(item, run.answer, rcontext);
				if (verdict.pass)
					passed++;
				return Object.assign({}, run, { pass: verdict.pass, reasons: verdict.reasons });
			});

			rresults.push({ id: item.id, topic: item.topic, prompt: item.prompt, passed: passed, runs: old.runs, details: details });
			console.log((passed === old.runs ? 'PASS ' : (passed ? 'FLAKY ' : 'FAIL ')) + item.id.padEnd(22) + passed + '/' + old.runs + (passed === old.runs ? '' : '  ' + details.filter(r => !r.pass).map(r => r.reasons.join('; ')).filter((value, index, list) => list.indexOf(value) === index).join(' | ')));
		});

		Fs.rmSync(rdir, { recursive: true, force: true });
		return summary(saved.model, rresults, saved.runs, opt);
	}

	var token = opt.token && opt.token !== true ? opt.token : '';
	var runs = Math.max(1, +opt.runs || 1);
	var timeout = Math.max(10, +opt.timeout || 240);
	var forge = !opt['no-forge'];
	var url = opt.url && opt.url !== true ? opt.url : '';
	var server = null;

	if (!url) {
		var port = await freeport();
		url = 'http://127.0.0.1:' + port;
		// Without the watcher (--release): a file that changes while the evaluation runs must not restart the server
		server = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port), '--release'], { cwd: ROOT, stdio: 'ignore', detached: true });
		process.on('exit', function() {
			try {
				process.kill(-server.pid);
			} catch (e) {}
		});
	}

	var ready = false;

	for (var i = 0; i < 100 && !ready; i++) {
		try {
			await request(url, token, 'account');
			ready = true;
		} catch (e) {
			await sleep(150);
		}
	}

	if (!ready) {
		console.error('The server does not answer at ' + url);
		return 1;
	}

	var models = await request(url, token, 'providers_models');
	var model = opt.model && opt.model !== true ? opt.model : models[0];

	if (!model || models.indexOf(model) === -1) {
		console.error('The model "' + (model || '') + '" is not available. Models: ' + models.join(', '));
		return 1;
	}

	// A Total.js project: Totem gives its Total.js knowledge to the model in a project that depends on total5
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totem-eval-'));
	Fs.writeFileSync(Path.join(dir, 'package.json'), JSON.stringify({ name: 'eval', dependencies: { total5: '*' } }));
	var context = { dir: dir, lenient: !!opt.lenient, serial: 0 };
	var project = await request(url, token, 'projects_open', { path: dir });
	var created = [];
	var results = [];

	console.log('Model: ' + model + ' | cases: ' + cases.length + ' | runs: ' + runs + ' | Forge: ' + (forge ? 'on (the pages of Forge go to the model, as in a real project)' : 'off') + '\n');

	try {

		for (var item of cases) {

			var passed = 0;
			var runsdata = [];

			for (var run = 0; run < runs; run++) {

				var session = await request(url, token, 'sessions_create', { projectid: project.id, model: model, name: 'eval ' + item.id, reasoning: opt.reasoning && opt.reasoning !== true ? opt.reasoning : '' });
				created.push(session.id);

				var started = Date.now();
				var result = await ask(url, token, session.id, item.prompt, timeout, forge);
				var text = await answerof(url, token, session.id);
				var verdict = judge(item, text, context);

				if (result.status !== 'idle')
					verdict = { pass: false, reasons: ['the run ended as ' + result.status] };

				if (verdict.pass)
					passed++;

				runsdata.push({ pass: verdict.pass, reasons: verdict.reasons, seconds: Math.round((Date.now() - started) / 100) / 10, tools: result.tools, knowledge: result.knowledge, answer: text });
			}

			results.push({ id: item.id, topic: item.topic, prompt: item.prompt, passed: passed, runs: runs, details: runsdata });
			console.log((passed === runs ? 'PASS ' : (passed ? 'FLAKY ' : 'FAIL ')) + item.id.padEnd(22) + passed + '/' + runs + (passed === runs ? '' : '  ' + runsdata.filter(r => !r.pass).map(r => r.reasons.join('; ')).filter((value, index, list) => list.indexOf(value) === index).join(' | ')));
		}

	} finally {

		for (var id of created)
			await request(url, token, 'sessions_remove/' + id).catch(() => {});

		await request(url, token, 'projects_remove/' + project.id).catch(() => {});
		Fs.rmSync(dir, { recursive: true, force: true });
	}

	return summary(model, results, runs, opt);
}

main().then(code => process.exit(code)).catch(function(err) {
	console.error(err);
	process.exit(1);
});
