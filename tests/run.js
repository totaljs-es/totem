require('total5');
require('total5/test');

// Native tests of Totem. They start the application in this process, with a disposable data folder and a scripted model.
// Run: node tests/run.js

const ROOT = Total.Path.join(__dirname, '..');
const TMP = Total.Fs.mkdtempSync(Total.Path.join(Total.Os.tmpdir(), 'totem-test-'));
const PROJECT = Total.Path.join(TMP, 'project');
const PORT = 8097;
const URL = 'http://127.0.0.1:' + PORT + '/api/';

['databases', 'tmp', 'logs', 'project'].forEach(name => Total.Fs.mkdirSync(Total.Path.join(TMP, name)));
Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'a.txt'), 'one\ntwo\nthree\n');
// A plain Node.js project: Totem does not write Total.js in it
Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'package.json'), '{ "name": "plain" }');
process.chdir(ROOT);

function check(message, ok) {
	Test.print(message, ok ? null : 'failed');
}

function api(schema, data) {
	if (/^sessions_prompt\//.test(schema))
		promptmark[schema.split('/')[1]] = eventcount;
	return new Promise(function(resolve) {
		RESTBuilder.POST(URL, { schema: schema, data: data }).exec(function(err, response) {
			resolve({ err: err, response: response });
		});
	});
}

// The scripted model: every request looks at the last message and answers with the next step of the script
var script = [];
var requests = [];

var lastconf = null;
var usedmodels = [];
var maxchildren = 0;

function fake(ai, callback) {

	lastconf = ai.conf;
	usedmodels.push(ai.payload.model);
	Object.keys(MAIN.running).forEach(k => maxchildren = Math.max(maxchildren, (MAIN.running[k].children || []).length));
	requests.push(ai.payload);

	// A request to summarize is answered without using the script
	if (ai.payload.messages[0].content.indexOf('Summarize the conversation') === 0) {
		callback(null, { content: 'SUMMARY of the work', thinking: '', tools: [] });
		return;
	}

	var step = script.shift();

	if (step && step.error) {
		callback(step.error);
		return;
	}
	if (!step) {
		callback('script ended');
		return;
	}

	if (step.wait) {
		ai.options.abort = function() {
			clearTimeout(timer);
			callback('aborted');
		};
		var timer = setTimeout(() => callback(null, { content: 'late', tools: [] }), step.wait);
		return;
	}

	var output = { content: step.content || '', thinking: '', tools: step.tools || [] };

	if (step.content)
		ai.options.stream && ai.options.stream({ type: 'content', delta: step.content, content: step.content });

	for (var tool of output.tools)
		ai.options.stream && ai.options.stream({ type: 'tool_start', tool: { id: tool.id, name: tool.name, arguments: {} } });

	setImmediate(() => callback(null, output));
}

// Collects the events the interface would receive
var events = [];
var eventcount = 0;
// The number of events when a prompt was sent: idle() waits for an idle that comes after it, never for the one of the run before
var promptmark = {};

function until(fn, ms) {
	return new Promise(function(resolve) {
		var started = Date.now();
		var timer = setInterval(function() {
			if (fn() || Date.now() - started > (ms || 5000)) {
				clearInterval(timer);
				resolve(fn());
			}
		}, 20);
	});
}

Test.push('boot', function(next) {

	F.run({ watcher: false, release: false, ip: '127.0.0.1', port: PORT, config: { $dirdatabases: Total.Path.join(TMP, 'databases'), $dirtmp: Total.Path.join(TMP, 'tmp'), $dirlogs: Total.Path.join(TMP, 'logs') } });

	ON('ready', function() {
		NEWAIMODEL('fake', fake);
		NEWAIMODEL('fake2', fake);
		// The data is copied: a part keeps changing after the event, like on the wire
		// The tests never go to the real Forge: the documents of Forge have their own test with a server of this computer
		CONF.forgedocs = false;
		FUNC.onevent = (sessionid, type, data) => events.push({ n: ++eventcount, sessionid: sessionid, type: type, data: JSON.parse(JSON.stringify(data)) });
		check('the application starts', true);
		check('the tools are registered as actions', !!F.actions['Tools|read'] && !!F.actions['Tools|bash']);

		// "ready" is emitted before the server accepts requests: wait for the API
		var started = Date.now();
		var wait = function() {
			api('account').then(function(r) {
				if (r.response && r.response.id) {
					check('the API answers', true);
					next();
				} else if (Date.now() - started > 10000)
					check('the API answers', false);
				else
					setTimeout(wait, 100);
			});
		};
		wait();
	});
});

Test.push('tool definitions', function(next) {
	var defs = MODS.agent.definitions();
	var read = defs.find(d => d.function.name === 'read');
	check('every tool has a definition', defs.length === 13);
	check('arguments are flattened', read && read.function.parameters.properties.path && read.function.parameters.required.indexOf('path') !== -1);
	check('the descriptions of the fields reach the model', read && !!read.function.parameters.properties.path.description);
	next();
});

Test.push('project boundary', async function(next) {
	check('a path inside the project resolves', !!FUNC.resolve(PROJECT, 'a.txt'));
	check('a new file inside the project resolves', !!FUNC.resolve(PROJECT, 'src/new.js'));
	check('.. is refused', FUNC.resolve(PROJECT, '../x') === null);
	check('an absolute path outside is refused', FUNC.resolve(PROJECT, '/etc/passwd') === null);
	Total.Fs.symlinkSync('/etc', Total.Path.join(PROJECT, 'link'));
	check('a symbolic link that leaves the project is refused', FUNC.resolve(PROJECT, 'link/passwd') === null);
	next();
});

var projectid, sessionid;

Test.push('projects and sessions', async function(next) {
	var r = await api('projects_open', { path: PROJECT });
	projectid = r.response && r.response.id;
	check('a project opens', !!projectid);
	r = await api('projects_open', { path: PROJECT });
	check('opening it again does not duplicate it', r.response.id === projectid);
	r = await api('projects_open', { path: '/nonexistent/folder' });
	check('a missing folder is refused', !!(r.err && r.err.items && r.err.items[0].error));
	r = await api('sessions_create', { projectid: projectid, model: 'fake' });
	sessionid = r.response && r.response.id;
	check('a session is created', !!sessionid);
	next();
});

Test.push('agent run: read, write, answer', async function(next) {

	script = [
		{ content: 'Let me look.', tools: [{ id: 'c1', name: 'read', arguments: { path: 'a.txt' } }] },
		{ tools: [{ id: 'c2', name: 'write', arguments: { path: 'src/b.txt', content: 'hello' } }] },
		{ content: 'Done.' }
	];

	var r = await api('sessions_prompt/' + sessionid, { text: 'do it' });
	check('the prompt is accepted at once', !!(r.response && r.response.messageid));

	// write asks the user: answer once
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('write asks for permission', !!ask && ask.data.tool === 'write');
	r = await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	check('the reply is accepted', r.response && r.response.success === true);

	var idle = await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	check('the session ends idle', idle);
	check('the file was written inside the project', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'src/b.txt'), 'utf8') === 'hello');
	check('read ran without asking', !events.some(e => e.type === 'permission.ask' && e.data.tool === 'read'));

	r = await api('sessions_messages/' + sessionid);
	var assistant = r.response.find(m => m.role === 'assistant');
	var tools = assistant.parts.filter(p => p.type === 'tool');
	check('messages are stored with ordered parts', r.response.length === 2 && assistant.parts[0].type === 'text');
	check('the user message comes before the answer', r.response[0].role === 'user' && r.response[1].role === 'assistant');
	check('tool parts keep input and output', tools.length === 2 && tools[0].data.output.indexOf('1\tone') !== -1 && tools[1].data.status === 'done');
	check('the second request carried the tool result', requests[1].messages.some(m => m.role === 'tool' && m.content.indexOf('one') !== -1));
	check('the deltas were streamed', events.some(e => e.type === 'part.delta'));
	next();
});

Test.push('permissions', async function(next) {

	events.length = 0;
	script = [{ tools: [{ id: 'd1', name: 'write', arguments: { path: 'c.txt', content: 'x' } }] }, { content: 'Stopped.' }];
	await api('sessions_prompt/' + sessionid, { text: 'write c' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	check('a rejected write does not happen', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'c.txt')));
	check('the model is told not to retry a rejection', requests[requests.length - 1].messages.some(m => m.role === 'tool' && /do not try it again/i.test(m.content) && m.content.indexOf('@(') === -1));
	var r = await api('sessions_messages/' + sessionid);
	var denied = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('the rejection is stored as denied', denied && denied.data.status === 'denied');

	events.length = 0;
	script = [{ tools: [{ id: 'e1', name: 'read', arguments: { path: '../outside' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + sessionid, { text: 'read outside' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	r = await api('sessions_messages/' + sessionid);
	denied = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('a path outside the project is denied without asking', denied.data.status === 'denied' && !events.some(e => e.type === 'permission.ask'));
	next();
});

Test.push('repeated rejections', async function(next) {

	var id = await session();
	events.length = 0;
	script = [];
	for (var i = 0; i < 5; i++)
		script.push({ tools: [{ id: 'w' + i, name: 'write', arguments: { path: 'never' + i + '.txt', content: 'x' } }] });

	await api('sessions_prompt/' + id, { text: 'keep trying' });

	for (var n = 0; n < 3; n++) {
		var ask = await until(() => events.filter(e => e.type === 'permission.ask')[n]);
		await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	}

	await idle(id);
	check('the run stops after three rejected actions', script.length === 2 && !events.some(e => e.type === 'permission.ask' && events.filter(x => x.type === 'permission.ask').length > 3));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the stop is explained in the conversation', parts[parts.length - 1].type === 'text' && /Stopped/.test(parts[parts.length - 1].data.text));
	next();
});

Test.push('bash and abort', async function(next) {

	events.length = 0;
	script = [{ tools: [{ id: 'f1', name: 'bash', arguments: { command: 'pwd; echo hi' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + sessionid, { text: 'run' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	var r = await api('sessions_messages/' + sessionid);
	var part = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('a command runs in the project root', part.data.output.indexOf(Total.Fs.realpathSync(PROJECT)) !== -1 && part.data.output.indexOf('hi') !== -1);

	events.length = 0;
	script = [{ wait: 10000 }];
	await api('sessions_prompt/' + sessionid, { text: 'slow' });
	await until(() => MAIN.running[sessionid]);
	await api('sessions_abort/' + sessionid);
	var aborted = await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'aborted'));
	check('abort stops a running model call', aborted && !MAIN.running[sessionid]);
	next();
});


function session(options) {
	return api('sessions_create', Object.assign({ projectid: projectid, model: 'fake' }, options || {})).then(r => r.response.id);
}

function idle(id) {
	var mark = promptmark[id] || 0;
	return until(() => events.filter(e => e.n > mark && e.sessionid === id && e.type === 'session.status' && e.data.status === 'idle').length > 0);
}

Test.push('diff', function(next) {
	var diff = MODS.snapshots.diff;
	var r = diff('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nX\nd\ne\nf\ng\nh\ni\n');
	check('diff counts additions and deletions', r.additions === 2 && r.deletions === 1);
	check('diff has a unified hunk with context', r.patch.indexOf('@@ -1,') === 0 && r.patch.indexOf('-c') !== -1 && r.patch.indexOf('+X') !== -1 && r.patch.indexOf(' b') !== -1);
	check('equal texts have no diff', diff('a\nb\n', 'a\nb\n').patch === '');
	check('an empty original is all additions', diff('', 'x\ny\n').additions === 2);
	next();
});

Test.push('snapshots: diff and undo', async function(next) {

	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [
		{ tools: [{ id: 's1', name: 'write', arguments: { path: 'n.txt', content: 'new file\n' } }, { id: 's2', name: 'edit', arguments: { path: 'a.txt', oldstring: 'two', newstring: 'TWO' } }] },
		{ content: 'Changed.' }
	];

	await api('sessions_prompt/' + id, { text: 'change things' });
	await idle(id);
	check('auto-accept lets edits run without asking', !events.some(e => e.type === 'permission.ask') && Total.Fs.existsSync(Total.Path.join(PROJECT, 'n.txt')));

	var r = await api('sessions_diff/' + id);
	var files = r.response;
	var a = files.find(f => f.path === 'a.txt');
	var n = files.find(f => f.path === 'n.txt');
	check('the diff lists the changed files', files.length === 2 && a.status === 'modified' && n.status === 'added');
	check('the diff has the lines', a.additions === 1 && a.deletions === 1 && a.patch.indexOf('-two') !== -1 && a.patch.indexOf('+TWO') !== -1);

	r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	r = await api('sessions_undo/' + id, { messageid: assistant.id });
	check('undo restores the files', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'a.txt'), 'utf8') === 'one\ntwo\nthree\n' && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'n.txt')));
	r = await api('sessions_diff/' + id);
	check('the diff is empty after undo', r.response.length === 0);
	next();
});

Test.push('tool errors', async function(next) {
	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [{ tools: [{ id: 'e1', name: 'read', arguments: {} }, { id: 'e2', name: 'read', arguments: { path: 'missing.txt' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'bad calls' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var tools = r.response.find(m => m.role === 'assistant').parts.filter(p => p.type === 'tool');
	check('a call with a missing argument names the argument', /path/.test(tools[0].data.error) && tools[0].data.status === 'error');
	check('an error has no translation markers', tools[1].data.error === 'File not found');
	next();
});

Test.push('patch tool', async function(next) {

	var user = { id: 'agent', sa: true, root: PROJECT, sessionid: 'x', projectid: projectid };
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'p.txt'), 'alpha\nbeta\ngamma\n');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'gone.txt'), 'bye\n');

	var patch = ['*** Begin Patch', '*** Update File: p.txt', '@@', ' alpha', '-beta', '+BETA', '+beta2', ' gamma', '*** Add File: q/new.txt', '+hello', '*** Delete File: gone.txt', '*** End Patch'].join('\n');
	var out = await ACTION('Tools|patch', { patch: patch }).user(user).promise();
	check('a patch updates, adds and deletes', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'p.txt'), 'utf8') === 'alpha\nBETA\nbeta2\ngamma\n' && Total.Fs.readFileSync(Total.Path.join(PROJECT, 'q/new.txt'), 'utf8') === 'hello\n' && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'gone.txt')));

	var bad = ['*** Begin Patch', '*** Add File: z.txt', '+z', '*** Update File: p.txt', '@@', '-does not exist', '+x', '*** End Patch'].join('\n');
	var failed = false;
	try {
		await ACTION('Tools|patch', { patch: bad }).user(user).promise();
	} catch (e) {
		failed = true;
	}
	check('a patch that does not match writes nothing', failed && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'z.txt')));

	failed = false;
	try {
		await ACTION('Tools|patch', { patch: ['*** Begin Patch', '*** Add File: ../escape.txt', '+x', '*** End Patch'].join('\n') }).user(user).promise();
	} catch (e) {
		failed = true;
	}
	check('a patch outside the project is refused', failed);
	next();
});

Test.push('instructions and skills', async function(next) {

	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'AGENTS.md'), '# Rules\nAlways use tabs.\n');
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.claude/skills/demo'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.claude/skills/demo/SKILL.md'), '---\nname: demo\ndescription: A demonstration skill\n---\n\n# Demo\nDo the demo steps.\n');

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'k1', name: 'skill', arguments: { name: 'demo' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'use the skill' });
	await idle(id);

	var system = requests[0].messages[0].content;
	check('AGENTS.md is part of the system prompt', system.indexOf('Always use tabs.') !== -1);
	check('the skills are listed with their description', system.indexOf('- demo: A demonstration skill') !== -1);
	check('the skill tool returns the body', requests[1].messages.some(m => m.role === 'tool' && m.content.indexOf('Do the demo steps.') !== -1));
	check('the skill tool ran without asking', !events.some(e => e.type === 'permission.ask'));
	next();
});

Test.push('todo and ask tools', async function(next) {

	var id = await session();
	events.length = 0;
	script = [
		{ tools: [{ id: 't1', name: 'todo', arguments: { todos: JSON.stringify([{ text: 'one', status: 'in_progress' }, { text: 'two', status: 'pending' }]) } }] },
		{ tools: [{ id: 't2', name: 'ask', arguments: { question: 'Which database?', options: ['PostgreSQL', 'NoSQL'] } }] },
		{ content: 'Thanks.' }
	];

	await api('sessions_prompt/' + id, { text: 'plan' });
	var question = await until(() => events.find(e => e.type === 'question.ask'));
	check('the todo tool updates the list and emits it', events.some(e => e.type === 'todo.updated' && e.data.items.length === 2));
	check('the ask tool waits for the user', !!question && question.data.options.length === 2);
	var r = await api('sessions_todos/' + id);
	check('the task list is stored', r.response.length === 2 && r.response[0].status === 'in_progress');

	await api('questions_reply/' + question.data.id, { answer: 'PostgreSQL' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	var ask = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'tool' && p.data.tool === 'ask');
	check('the answer returns to the model as the tool result', ask && ask.data.output === 'PostgreSQL');
	next();
});

Test.push('retry', async function(next) {

	CONF.retrybase = 10;
	var id = await session();
	events.length = 0;
	script = [{ error: '503: overloaded' }, { error: 'ECONNRESET' }, { content: 'Recovered.' }];
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	check('transient errors are retried and reported', events.filter(e => e.type === 'error' && e.data.retry === true).length === 2);

	events.length = 0;
	script = [{ error: '401: invalid key' }];
	await api('sessions_prompt/' + id, { text: 'again' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('an authentication error is not retried', events.filter(e => e.type === 'error').length === 1 && events.find(e => e.type === 'error').data.retry === false);

	events.length = 0;
	script = [{ error: '503: a' }, { error: '503: b' }, { error: '503: c' }, { error: '503: d' }];
	await api('sessions_prompt/' + id, { text: 'again' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('retries stop after the limit', events.filter(e => e.type === 'error' && e.data.retry === true).length === 3);
	next();
});

Test.push('compaction', async function(next) {

	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'big.txt'), ('x'.repeat(99) + '\n').repeat(50));

	async function reads(count) {
		var id = await session();
		events.length = 0;
		requests.length = 0;
		script = [];
		for (var i = 0; i < count; i++)
			script.push({ tools: [{ id: 'r' + i, name: 'read', arguments: { path: 'big.txt' } }] });
		script.push({ content: 'Finished.' });
		await api('sessions_prompt/' + id, { text: 'read it many times' });
		await idle(id);
		return id;
	}

	// Level 1: about 1300 tokens per read, the limit allows the six newest outputs
	CONF.contextlimit = 9500;
	var id = await reads(9);
	check('old tool output is reduced to one line', requests.some(r => r.messages.some(m => m.role === 'tool' && m.content.indexOf('[output omitted') === 0)));
	check('level 1 does not call the model to summarize', !requests.some(r => r.messages[0].content.indexOf('Summarize the conversation') === 0));

	// Level 2: the limit is lower than six outputs
	CONF.contextlimit = 600;
	id = await reads(9);
	check('older turns become a summary', requests.some(r => r.messages.some(m => m.role === 'user' && m.content.indexOf('Summary of the earlier conversation') === 0)));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the stored history keeps everything and notes the compaction', parts.filter(p => p.type === 'tool').length === 9 && parts.some(p => p.type === 'compaction'));

	CONF.contextlimit = 100000;
	next();
});

Test.push('real provider over HTTP', async function(next) {

	var mock = require('./mock-openai');
	await new Promise(resolve => mock.start(8111, resolve));

	var r = await api('providers_save', { name: 'Mock', url: 'http://127.0.0.1:8111/v1', key: 'secret-key', models: ['mock'] });
	check('a provider is saved', r.response && r.response.success === true);

	r = await api('providers');
	check('the key is never returned', r.response.length === 1 && r.response[0].haskey === true && r.response[0].key === undefined);
	var stored = await NOSQL('providers').read().where('id', 'mock').promise();
	check('the key is stored encrypted', stored.key && stored.key !== 'secret-key' && FUNC.decryptkey(stored.key) === 'secret-key');

	await new Promise(resolve => setTimeout(resolve, 200));
	r = await api('providers_models');
	check('its models can be chosen', r.response.indexOf('mock:mock') !== -1);

	r = await api('sessions_create', { projectid: projectid, model: 'mock:mock' });
	var id = r.response.id;
	events.length = 0;

	await api('sessions_prompt/' + id, { text: 'please read the file' });
	await until(() => events.some(e => e.type === 'permission.ask') || events.some(e => e.type === 'session.status' && e.data.status === 'idle'));
	check('read runs without asking', !events.some(e => e.type === 'permission.ask'));
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);

	r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	var tool = assistant.parts.find(p => p.type === 'tool');
	var texts = assistant.parts.filter(p => p.type === 'text').map(p => p.data.text).join('|');
	check('the stream of the provider was parsed into text and a tool call', texts.indexOf('Let me look at the file.') !== -1 && tool && tool.data.tool === 'read' && tool.data.input.path === 'README.md');
	check('the answer follows the tool result', texts.indexOf('I read the file.') !== -1);
	check('the provider received the key and the tools', mock.requests.length === 2 && mock.requests[0].tools.length === 13 && mock.requests[0].model === 'mock');

	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'please fail' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a provider error ends the run with a visible error', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
	next();
});

Test.push('providers, discovery and model metadata', async function(next) {

	var base = 'http://127.0.0.1:8111/v1';
	var r = await api('providers_templates');
	var ids = r.response.map(t => t.id);
	check('templates cover local servers and remote catalogues', ['ollama', 'llamacpp', 'lmstudio', 'openrouter', 'openai'].every(id => ids.indexOf(id) !== -1) && r.response.find(t => t.id === 'ollama').local === true);

	r = await api('providers_available', { url: base, kind: 'ollama' });
	var tiny = r.response.find(m => m.id === 'tiny:1b');
	var big = r.response.find(m => m.id === 'big:7b');
	check('Ollama models come with capabilities and context', r.response.length === 2 && tiny.tools === false && big.tools === true && big.reasoning === true && big.context === 32768 && tiny.context === 8192);

	r = await api('providers_available', { url: base, kind: 'openrouter' });
	var free = r.response.find(m => m.id === 'free-model:free');
	var paid = r.response.find(m => m.id === 'paid-model');
	var plain = r.response.find(m => m.id === 'plain-model');
	check('catalogue models say if they are free and support tools', free.free === true && free.tools === true && free.reasoning === true && free.context === 65536 && paid.free === false && paid.tools === false);
	check('unknown values stay null', plain.tools === null && plain.free === null && plain.context === null);
	check('catalogue models carry their price per token', free.price.input === 0 && paid.price.input === 0.000001 && paid.price.output === 0.000002 && plain.price === null);

	// Detection on this computer: the local templates point to the mock (Ollama) or to a closed port
	var saved = MAIN.templates;
	MAIN.templates = saved.map(t => (t.local || t.detect) ? Object.assign({}, t, { url: t.id === 'ollama' ? base : 'http://127.0.0.1:1/v1' }) : t);
	r = await api('providers_detect');
	MAIN.templates = saved;
	check('detection finds the servers that answer and skips the others', r.response.length === 1 && r.response[0].template.id === 'ollama' && r.response[0].models.length === 2);

	r = await api('providers_save', { name: 'Local mock', url: base, kind: 'openai', models: ['tiny:1b', 'big:7b'], meta: { 'tiny:1b': { id: 'tiny:1b', context: 8192, tools: false }, 'big:7b': { id: 'big:7b', context: 32768, tools: true, reasoning: true } } });
	check('a provider is saved with the metadata of its models', r.response && r.response.success === true);
	await new Promise(resolve => setTimeout(resolve, 200));

	r = await api('providers_catalog');
	var entry = r.response.find(m => m.id === 'local-mock:tiny:1b');
	check('the catalogue lists the models with what they can do', entry && entry.tools === false && entry.context === 8192 && r.response.find(m => m.id === 'local-mock:big:7b').reasoning === true);

	var mock = require('./mock-openai');
	var id = await session({ model: 'local-mock:tiny:1b' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello without tools' });
	await idle(id);
	check('a model without tool support gets a request without tools', mock.requests.length === 1 && mock.requests[0].tools === undefined);

	r = await api('sessions_messages/' + id);
	var step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('the usage of the request is kept in the step', step.data.tokens && step.data.tokens.input === 12 && step.data.tokens.output === 5);

	id = await session({ model: 'local-mock:big:7b' });
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello with tools' });
	await idle(id);
	check('a model with tool support gets the tools', mock.requests[0].tools && mock.requests[0].tools.length === 13);
	next();
});

Test.push('Anthropic and Gemini', async function(next) {

	var mock = require('./mock-openai');
	var root = 'http://127.0.0.1:8111';

	// The conversion of the conversation
	var tools = [{ role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }, { id: 'b', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*"}' } }] }, { role: 'tool', tool_call_id: 'a', content: 'one' }, { role: 'tool', tool_call_id: 'b', content: 'two' }];
	var a = MODS.provider.toanthropic([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }].concat(tools));
	check('Anthropic: the system prompt is separate', a.system === 'SYS' && a.messages[0].role === 'user');
	check('Anthropic: tool calls become tool_use blocks', a.messages[1].role === 'assistant' && a.messages[1].content[0].type === 'text' && a.messages[1].content[1].type === 'tool_use' && a.messages[1].content[1].input.path === 'x');
	check('Anthropic: the results of one step go in one user message', a.messages.length === 3 && a.messages[2].content.length === 2 && a.messages[2].content[1].tool_use_id === 'b');

	var g = MODS.provider.togemini([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }].concat(tools));
	check('Gemini: the system prompt is separate and the assistant is the model', g.system === 'SYS' && g.contents[1].role === 'model' && g.contents[1].parts[1].functionCall.name === 'read');
	check('Gemini: results carry the name of their function', g.contents[2].parts.length === 2 && g.contents[2].parts[0].functionResponse.name === 'read' && g.contents[2].parts[1].functionResponse.name === 'glob');

	var hist = MODS.provider.togemini([{ role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', thoughtSignature: 'SIG', function: { name: 'read', arguments: '{}' } }] }]);
	check('Gemini: a stored signature goes back in its function call', hist.contents[0].parts[0].thoughtSignature === 'SIG');

	// Discovery with the key in the header of each API
	var r = await api('providers_available', { url: root, kind: 'anthropic', key: 'test-key' });
	check('Anthropic models are listed with their context', r.response.length === 1 && r.response[0].id === 'claude-test' && r.response[0].context === 200000 && r.response[0].tools === true);
	r = await api('providers_available', { url: root, kind: 'gemini', key: 'test-key' });
	check('Gemini models are listed and only the ones that generate', r.response.length === 1 && r.response[0].id === 'gemini-test' && r.response[0].context === 1048576);

	// A conversation with each provider
	await api('providers_save', { name: 'Claude mock', url: root, kind: 'anthropic', key: 'test-key', models: ['claude-test'] });
	await api('providers_save', { name: 'Gemini mock', url: root, kind: 'gemini', key: 'test-key', models: ['gemini-test'] });
	await new Promise(resolve => setTimeout(resolve, 300));

	for (var kind of ['anthropic', 'gemini']) {

		var id = await session({ model: (kind === 'anthropic' ? 'claude-mock:claude-test' : 'gemini-mock:gemini-test') });
		events.length = 0;
		mock.calls.length = 0;
		await api('sessions_prompt/' + id, { text: 'please read the file' });
		await until(() => events.some(e => e.type === 'permission.ask') || events.some(e => e.type === 'session.status' && e.data.status === 'idle'));
		await idle(id);

		var calls = mock.calls.filter(c => c.kind === kind);
		var label = kind === 'anthropic' ? 'Anthropic' : 'Gemini';
		check(label + ': the conversation takes two requests with the key in its header', calls.length === 2);

		if (kind === 'anthropic') {
			check('Anthropic: system, tools with input_schema and max_tokens are sent', calls[0].body.system.indexOf('You are Totem') === 0 && calls[0].body.tools.length === 13 && !!calls[0].body.tools[0].input_schema && calls[0].body.max_tokens > 0);
			check('Anthropic: the second request carries the tool result', calls[1].body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'toolu_1')));
		} else {
			check('Gemini: system instruction and function declarations are sent', calls[0].body.systemInstruction.parts[0].text.indexOf('You are Totem') === 0 && calls[0].body.tools[0].functionDeclarations.length === 13 && JSON.stringify(calls[0].body.tools).indexOf('additionalProperties') === -1);
			check('Gemini: the signature of the function call is sent back', calls[1].body.contents.some(c => c.role === 'model' && c.parts.some(p => p.functionCall && p.thoughtSignature === 'sig-123')));
			check('Gemini: the second request carries the function response', calls[1].body.contents.some(c => c.parts.some(p => p.functionResponse && p.functionResponse.name === 'read')));
		}

		r = await api('sessions_messages/' + id);
		var assistant = r.response.find(m => m.role === 'assistant');
		var texts = assistant.parts.filter(p => p.type === 'text').map(p => p.data.text).join('|');
		var tool = assistant.parts.find(p => p.type === 'tool');
		var steps = assistant.parts.filter(p => p.type === 'step');
		check(label + ': text and the tool call are parsed from the stream', texts.indexOf('Let me read it.') !== -1 && texts.indexOf(label + ' saw') !== -1 && tool && tool.data.tool === 'read');
		check(label + ': the usage of every step is kept', steps[0].data.tokens && steps[0].data.tokens.input > 0 && steps[0].data.tokens.output > 0);
	}

	// A wrong key is a visible error
	await api('providers_save', { name: 'Claude bad', url: root, kind: 'anthropic', key: 'wrong', models: ['claude-test'] });
	await new Promise(resolve => setTimeout(resolve, 300));
	var bad = await session({ model: 'claude-bad:claude-test' });
	events.length = 0;
	await api('sessions_prompt/' + bad, { text: 'hello' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a rejected key ends the run with the error of the provider', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
	next();
});

Test.push('sub-agents and commands', async function(next) {

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'ta', name: 'task', arguments: { agent: 'explore', prompt: 'Find the lines of a.txt' } }] },
		{ tools: [{ id: 'cr', name: 'read', arguments: { path: 'a.txt' } }] },
		{ content: 'FOUND three lines' },
		{ content: 'The sub-agent said it.' }
	];

	await api('sessions_prompt/' + id, { text: 'delegate' });
	await idle(id);

	check('the task tool runs without asking', !events.some(e => e.type === 'permission.ask'));
	check('the sub-agent has its own prompt and context', requests.length === 4 && requests[1].messages[0].content.indexOf('You are the explore agent') === 0 && requests[1].messages.length === 2 && requests[1].messages[1].content === 'Find the lines of a.txt');
	check('the sub-agent only gets the tools of its definition', JSON.stringify(requests[1].tools.map(t => t.function.name)) === JSON.stringify(['read', 'glob', 'grep', 'fetch', 'skill']));
	check('the parent lists the agents it can delegate to', requests[0].messages[0].content.indexOf('- explore:') !== -1 && requests[0].messages[0].content.indexOf('- general:') !== -1);
	check('the progress of the sub-agent is shown in the tool call', events.some(e => e.type === 'part.updated' && e.data.part.data.tool === 'task' && /\[read\] done/.test(e.data.part.data.output || '')));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	var task = parts.find(p => p.type === 'tool' && p.data.tool === 'task');
	check('only the final answer comes back to the parent', task.data.status === 'done' && task.data.output === 'FOUND three lines' && requests[3].messages.some(m => m.role === 'tool' && m.content === 'FOUND three lines'));
	check('the tool calls of the sub-agent are not part of the conversation', parts.filter(p => p.type === 'tool').length === 1);

	events.length = 0;
	script = [{ tools: [{ id: 'tb', name: 'task', arguments: { agent: 'nope', prompt: 'x' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'delegate again' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	var bad = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('an unknown agent is an error that lists the available ones', bad.data.status === 'error' && /Unknown agent "nope"\. Available: explore, general/.test(bad.data.error));

	// The sub-agent asks the user like any other agent
	events.length = 0;
	script = [
		{ tools: [{ id: 'tc', name: 'task', arguments: { agent: 'general', prompt: 'Create w.txt' } }] },
		{ tools: [{ id: 'cw', name: 'write', arguments: { path: 'w.txt', content: 'x' } }] },
		{ content: 'Could not write.' },
		{ content: 'Reported.' }
	];
	await api('sessions_prompt/' + id, { text: 'delegate a write' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('a write of a sub-agent asks in the session of the user', !!ask && ask.data.tool === 'write');
	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await idle(id);
	check('a rejected write of a sub-agent does not happen', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'w.txt')));

	// Commands of the project
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem/commands'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/commands/review.md'), '---\ndescription: Review a file\n---\nReview $ARGUMENTS carefully.\n');
	r = await api('projects_commands/' + projectid);
	check('the commands and the agents of a project are listed', r.response.commands.length === 3 && r.response.commands[0].name === 'init' && r.response.commands[1].name === 'new' && r.response.commands[2].name === 'review' && r.response.commands[2].description === 'Review a file' && r.response.agents.length === 2);

	id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Reviewed.' }, { content: 'Again.' }];
	await api('sessions_prompt/' + id, { text: '/review a.txt' });
	await idle(id);
	check('a command sends its expanded text to the model', requests[0].messages[requests[0].messages.length - 1].content === 'Review a.txt carefully.');
	r = await api('sessions_messages/' + id);
	var shown = r.response.find(m => m.role === 'user').parts[0].data;
	check('the conversation keeps what the user typed', shown.text === '/review a.txt' && shown.expanded === 'Review a.txt carefully.');
	await api('sessions_prompt/' + id, { text: '/unknown thing' });
	await idle(id);
	check('the history sends the expanded text and an unknown command is plain text', requests[1].messages.some(m => m.role === 'user' && m.content === 'Review a.txt carefully.') && requests[1].messages[requests[1].messages.length - 1].content === '/unknown thing');
	next();
});

Test.push('cost and reasoning effort', async function(next) {

	var mock = require('./mock-openai');
	var base = 'http://127.0.0.1:8111/v1';

	await api('providers_save', { name: 'Priced', url: base, kind: 'openai', models: ['p1'], meta: { p1: { id: 'p1', reasoning: true, tools: true, price: { input: 0.001, output: 0.002 } } } });
	await new Promise(resolve => setTimeout(resolve, 200));

	var id = await session({ model: 'priced:p1', reasoning: 'low' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);

	var r = await api('sessions_messages/' + id);
	var step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('the cost of a step follows the usage and the price', Math.abs(step.data.cost - 0.022) < 1e-9);
	check('the reasoning effort of the session is sent', mock.requests[0].reasoning_effort === 'low');

	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'again', reasoning: 'high' });
	await idle(id);
	// The read is repeated: a slow runner can answer the request with an error once
	for (var attempt = 0; attempt < 10; attempt++) {
		r = await api('sessions_read/' + id);
		if (r.response && r.response.reasoning === 'high')
			break;
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	check('a prompt can change the reasoning effort for the session', mock.requests[0].reasoning_effort === 'high' && !!r.response && r.response.reasoning === 'high');

	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'no change' });
	await idle(id);
	check('without a value the effort of the session stays', mock.requests[0].reasoning_effort === 'high');

	var plain = await session({ model: 'priced:p1' });
	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + plain, { text: 'default' });
	await idle(plain);
	check('an empty effort leaves the default of the model', mock.requests[0].reasoning_effort === undefined);

	// A local model costs nothing
	await api('providers_save', { name: 'Free local', url: base, kind: 'openai', models: ['tiny:1b'], meta: { 'tiny:1b': { id: 'tiny:1b', free: true, price: { input: 0, output: 0 }, tools: false } } });
	await new Promise(resolve => setTimeout(resolve, 200));
	var free = await session({ model: 'free-local:tiny:1b' });
	events.length = 0;
	await api('sessions_prompt/' + free, { text: 'free' });
	await idle(free);
	r = await api('sessions_messages/' + free);
	step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('a free model has a cost of zero', step.data.cost === 0);
	next();
});

Test.push('MCP client', async function(next) {

	var mockpath = Total.Path.join(ROOT, 'tests/mock-mcp.js');
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/mcp.json'), JSON.stringify({ servers: { mock: { command: process.execPath, args: [mockpath] }, web: { url: 'http://127.0.0.1:8111/mcp' } } }));

	// Answers every permission question of the session with a reply until the run ends
	function approver(replyfor) {
		var seen = {};
		return setInterval(function() {
			events.filter(e => e.type === 'permission.ask' && !seen[e.data.id]).forEach(function(e) {
				seen[e.data.id] = true;
				api('permissions_reply/' + e.data.id, { reply: replyfor(e.data) });
			});
		}, 30);
	}

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'm1', name: 'mock__echo', arguments: { text: 'hi' } }, { id: 'm2', name: 'web__echo', arguments: { text: 'over http' } }, { id: 'm3', name: 'mock__fail', arguments: {} }] },
		{ content: 'Done.' }
	];

	var timer = approver(() => 'once');
	await api('sessions_prompt/' + id, { text: 'use the mcp tools' });
	await idle(id);
	clearInterval(timer);

	var starts = events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start');
	check('every server of the project asks before it starts', starts.length === 2 && starts[0].data.patterns[0].indexOf('mock: ') === 0 && starts[1].data.patterns[0].indexOf('http://127.0.0.1:8111/mcp') !== -1);

	var names = requests[0].tools.map(t => t.function.name);
	check('the tools of the servers join the tools of Totem', names.indexOf('mock__echo') !== -1 && names.indexOf('web__echo') !== -1 && names.indexOf('read') !== -1);
	var echo = requests[0].tools.find(t => t.function.name === 'mock__echo').function;
	check('their definitions keep the schema and name the server', echo.description.indexOf('[mock]') === 0 && echo.parameters.required[0] === 'text');

	check('a tool of a server asks before it runs', events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp:mock__echo').length === 1);

	var r = await api('sessions_messages/' + id);
	var tools = r.response.find(m => m.role === 'assistant').parts.filter(p => p.type === 'tool');
	check('a tool over stdio answers', tools[0].data.status === 'done' && tools[0].data.output === 'echo: hi');
	check('a tool over HTTP answers, also as an event stream', tools[1].data.status === 'done' && tools[1].data.output === 'echo: over http');
	check('a tool that fails is an error for the model', tools[2].data.status === 'error' && tools[2].data.error === 'it failed');
	check('the program of the server stops with the run', !MAIN.children[id]);

	// The prompts of a server are offered through one tool
	id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'mp', name: 'mcp_prompt', arguments: { name: 'mock:review', arguments: { file: 'a.js' } } }] }, { content: 'Reviewed.' }];
	timer = approver(() => 'once');
	await api('sessions_prompt/' + id, { text: 'use the prompt' });
	await idle(id);
	clearInterval(timer);
	var promptdef = requests[0].tools.find(t => t.function.name === 'mcp_prompt');
	check('the prompts of the servers are one tool that lists them', !!promptdef && /mock:review \(Review code\)/.test(promptdef.function.description));
	check('a prompt gives its text to the model without asking', requests[1].messages.some(m => m.role === 'tool' && m.content === 'Review a.js for bugs.') && !events.some(e => e.type === 'permission.ask' && /prompt/.test(e.data.tool)));

	// When the user refuses to start the servers, their tools do not exist
	id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'No tools.' }];
	timer = approver(() => 'reject');
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	clearInterval(timer);
	check('refused servers add no tools', requests[0].tools.map(t => t.function.name).indexOf('mock__echo') === -1 && requests[0].tools.length === 13);

	Total.Fs.rmSync(Total.Path.join(PROJECT, '.totem/mcp.json'));
	next();
});

Test.push('Total.js knowledge: conventions and Forge', async function(next) {

	var TJS = Total.Path.join(TMP, 'tjs');
	Total.Fs.mkdirSync(Total.Path.join(TJS, 'schemas'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, 'package.json'), JSON.stringify({ name: 'app', dependencies: { total5: 'beta' } }));

	check('a project that depends on total5 is a Total.js project', MODS.instructions.istotaljs(TJS) === true && MODS.instructions.istotaljs(PROJECT) === false);

	// Forge comes with Totem for Total.js projects only, and the project can replace it
	check('Forge is a server of Total.js projects', MODS.mcpclient.servers(TJS).forge.url === 'https://forge.totaljs.es/mcp/');
	check('other projects do not get it', MODS.mcpclient.servers(PROJECT).forge === undefined);
	CONF.forge = false;
	check('it can be switched off in the config', MODS.mcpclient.servers(TJS).forge === undefined);
	CONF.forge = true;
	Total.Fs.mkdirSync(Total.Path.join(TJS, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, '.totem/mcp.json'), JSON.stringify({ servers: { forge: { url: 'http://127.0.0.1:8111/mcp' } } }));
	check('a project replaces a built-in server by name', MODS.mcpclient.servers(TJS).forge.url === 'http://127.0.0.1:8111/mcp');
	Total.Fs.unlinkSync(Total.Path.join(TJS, '.totem/mcp.json'));

	// The skill of the conventions
	var names = MODS.instructions.skills(TJS).map(s => s.name);
	check('the conventions skill comes with Totem for Total.js projects', names.indexOf('totaljs-conventions') !== -1 && MODS.instructions.skills(PROJECT).map(s => s.name).indexOf('totaljs-conventions') === -1);
	check('the skill tells where Forge is', MODS.instructions.skill(TJS, 'totaljs-conventions').indexOf('forge__Forge_search') !== -1);
	Total.Fs.mkdirSync(Total.Path.join(TJS, '.claude/skills/totaljs-conventions'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, '.claude/skills/totaljs-conventions/SKILL.md'), '---\nname: totaljs-conventions\ndescription: Our own rules\n---\nOwn body\n');
	check('a skill of the project with the same name wins', MODS.instructions.skills(TJS).find(s => s.name === 'totaljs-conventions').description === 'Our own rules');
	Total.Fs.rmSync(Total.Path.join(TJS, '.claude'), { recursive: true });

	// The check of the conventions on what the tools write
	var user = { id: 'agent', sa: true, root: TJS, sessionid: 'x', projectid: projectid };
	var bad = "var fs = require('fs');\n\nNEWACTION('Bad/list', {\n\tname: 'List',\n\taction: function($) {\n\t\t$.callback([]);\n\t}\n});\n";
	var out = await ACTION('Tools|write', { path: 'schemas/bad.js', content: bad }).user(user).promise();
	check('a file that breaks the conventions comes back with the findings', /node-require/.test(out) && /name-separator/.test(out) && out.indexOf('Written schemas/bad.js') === 0);

	out = await ACTION('Tools|write', { path: 'schemas/good.js', content: "NEWACTION('Good|list', {\n\tname: 'List',\n\taction: function($) {\n\t\t$.callback([]);\n\t}\n});\n" }).user(user).promise();
	check('a file that follows them has no findings', out.indexOf('conventions') === -1);

	out = await ACTION('Tools|edit', { path: 'schemas/good.js', oldstring: '$.callback([]);', newstring: "var os = require('os');" }).user(user).promise();
	check('an edit is checked too', /node-require/.test(out));

	out = await ACTION('Tools|patch', { patch: ['*** Begin Patch', '*** Add File: schemas/patched.js', "+var path = require('path');", '*** End Patch'].join('\n') }).user(user).promise();
	check('a patch is checked too', /node-require/.test(out) && /patched\.js/.test(out));

	out = await ACTION('Tools|write', { path: 'plain.js', content: bad }).user({ id: 'agent', sa: true, root: PROJECT, sessionid: 'x', projectid: projectid }).promise();
	check('a project that is not Total.js is left alone', out.indexOf('conventions') === -1);

	CONF.conventions = false;
	out = await ACTION('Tools|write', { path: 'schemas/bad2.js', content: bad }).user(user).promise();
	check('the check can be switched off in the config', out.indexOf('conventions') === -1);
	CONF.conventions = true;

	// The prompt of a session in a Total.js project, and the question before Forge starts
	var opened = await api('projects_open', { path: TJS });
	var id = await api('sessions_create', { projectid: opened.response.id, model: 'fake' }).then(r => r.response.id);
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Hello.' }];

	var rejected = setInterval(function() {
		events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' }));
	}, 30);

	await api('sessions_prompt/' + id, { text: 'hi' });
	await idle(id);
	clearInterval(rejected);

	var system = requests[0].messages[0].content;
	check('the skills of the project include the conventions', system.indexOf('- totaljs-conventions:') !== -1);
	var ask = events.find(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start');
	check('Forge asks before it starts and says where it goes', !!ask && ask.data.patterns[0].indexOf('forge: https://forge.totaljs.es/mcp/') === 0);
	check('refusing Forge adds no tools', requests[0].tools.map(t => t.function.name).filter(n => /^forge__/.test(n)).length === 0);
	next();
});

Test.push('folders and provider icons', async function(next) {

	var r = await api('folders');
	check('the folders start at the home folder, with places', r.response.path === Total.Os.homedir() && r.response.sep === Total.Path.sep && r.response.places[0].name === 'Home' && r.response.places[0].path === Total.Os.homedir() && Array.isArray(r.response.items));

	Total.Fs.mkdirSync(Total.Path.join(PROJECT, 'inner/deeper'), { recursive: true });
	r = await api('folders?path=' + encodeURIComponent(PROJECT));
	var names = r.response.items.map(i => i.name);
	check('only folders are listed, not files or hidden folders', names.indexOf('inner') !== -1 && names.indexOf('src') !== -1 && names.indexOf('a.txt') === -1 && names.indexOf('.totem') === -1);
	check('a link to a folder counts as a folder', names.indexOf('link') !== -1);
	check('the folders are sorted', JSON.stringify(names) === JSON.stringify(names.slice().sort((a, b) => a.localeCompare(b))));

	r = await api('folders?hidden=1&path=' + encodeURIComponent(PROJECT));
	check('hidden folders can be asked for', r.response.items.some(i => i.name === '.totem'));

	r = await api('folders?path=' + encodeURIComponent(Total.Path.join(PROJECT, 'inner')));
	check('a folder inside is listed', r.response.path === Total.Path.join(PROJECT, 'inner') && r.response.items.length === 1 && r.response.items[0].name === 'deeper');

	r = await api('folders?path=' + encodeURIComponent(Total.Path.join(PROJECT, 'does-not-exist')));
	check('a missing folder is an error', !!(r.err && r.err.items && r.err.items[0].error));

	// The icon of a provider, in the list and in the catalogue of models
	var base = 'http://127.0.0.1:8111/v1';
	await api('providers_save', { name: 'OpenAI', url: base, kind: 'openai', icon: 'openai', models: ['gpt-x'] });
	await api('providers_save', { name: 'Google Gemini', url: base, kind: 'openai', icon: 'gemini', models: ['gem-x'] });
	await api('providers_save', { name: 'No icon', url: base, kind: 'openai', models: ['plain-x'] });
	await new Promise(resolve => setTimeout(resolve, 300));

	r = await api('providers');
	var by = {};
	r.response.forEach(p => by[p.id] = p);
	check('a provider keeps the icon it was saved with', by['google-gemini'].icon === 'gemini');
	check('a provider whose id is an icon gets it', by['openai'].icon === 'openai');
	check('a provider without an icon has none', by['no-icon'].icon === '' && by['mock'].icon === '');

	r = await api('providers_catalog');
	var gpt = r.response.find(m => m.id === 'openai:gpt-x');
	var gem = r.response.find(m => m.id === 'google-gemini:gem-x');
	var plain = r.response.find(m => m.id === 'no-icon:plain-x');
	check('the catalogue names the provider and its icon for every model', gpt.provider === 'OpenAI' && gpt.icon === 'openai' && gem.provider === 'Google Gemini' && gem.icon === 'gemini' && plain.provider === 'No icon' && plain.icon === '');
	check('every icon of the templates exists as a file', JSON.parse(Total.Fs.readFileSync(Total.Path.join(ROOT, 'private/providers.json'), 'utf8')).filter(t => t.icon).every(t => Total.Fs.existsSync(Total.Path.join(ROOT, 'public/img/providers', t.icon + '.svg'))));
	next();
});

Test.push('Total.js by default, with Forge in front of the prompt', async function(next) {

	var mock = require('./mock-openai');
	var mcp = require('./mock-mcp');

	// Which folders are Total.js projects
	var fresh = Total.Path.join(TMP, 'fresh');
	var java = Total.Path.join(TMP, 'java');
	var node = Total.Path.join(TMP, 'node');
	var tjs = Total.Path.join(TMP, 'tjs2');
	[fresh, java, node, tjs].forEach(dir => Total.Fs.mkdirSync(dir, { recursive: true }));
	Total.Fs.writeFileSync(Total.Path.join(java, 'pom.xml'), '<project/>');
	Total.Fs.writeFileSync(Total.Path.join(node, 'package.json'), '{ "dependencies": { "express": "1" } }');
	Total.Fs.writeFileSync(Total.Path.join(tjs, 'package.json'), '{ "dependencies": { "total5": "latest" } }');

	check('a new folder is a Total.js project', MODS.instructions.istotaljs(fresh) === true);
	check('a project of another kind is not', MODS.instructions.istotaljs(java) === false && MODS.instructions.istotaljs(node) === false);
	check('a project that depends on total5 is', MODS.instructions.istotaljs(tjs) === true);
	CONF.totaljs = 'never';
	check('never switches it off for every project', MODS.instructions.istotaljs(fresh) === false && MODS.instructions.istotaljs(tjs) === false);
	CONF.totaljs = 'always';
	check('always switches it on for every project', MODS.instructions.istotaljs(java) === true);
	CONF.totaljs = 'auto';

	// The primer in the system prompt of a new folder, not in a plain Node.js project
	var project = (await api('projects_open', { path: fresh })).response;
	var id = (await api('sessions_create', { projectid: project.id, model: 'fake' })).response.id;
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Hello.' }];
	var rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	await api('sessions_prompt/' + id, { text: 'quiero hacer un componente jcomponent' });
	await idle(id);
	clearInterval(rejecter);
	var system = requests[0].messages[0].content;
	check('a new folder gets the Total.js primer with the browser library and server boundary', system.indexOf('user interface library of Total.js') !== -1 && system.indexOf('NEWACTION(') === -1 && /Without a request for code/.test(system) && system.indexOf('Keep the answer focused on server code') !== -1);

	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Hello.' }];
	var plain = (await api('sessions_create', { projectid: projectid, model: 'fake' })).response.id;
	await api('sessions_prompt/' + plain, { text: 'quiero hacer un componente jcomponent' });
	await idle(plain);
	check('a plain Node.js project does not', requests[0].messages[0].content.indexOf('user interface library of Total.js') === -1);

	// Forge in front of the prompt: its search and its best pages go into the system prompt
	Total.Fs.mkdirSync(Total.Path.join(tjs, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(tjs, '.totem/mcp.json'), JSON.stringify({ servers: { forge: { url: 'http://127.0.0.1:8111/mcp' } } }));
	project = (await api('projects_open', { path: tjs })).response;
	id = (await api('sessions_create', { projectid: project.id, model: 'fake' })).response.id;
	events.length = 0;
	requests.length = 0;
	mcp.calls.length = 0;
	script = [{ content: 'Done.' }];
	var approver = setInterval(() => events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'once' })), 30);
	await api('sessions_prompt/' + id, { text: 'how do I write a custom jcomponent component' });
	await idle(id);
	clearInterval(approver);

	system = requests[0].messages[0].content;
	check('the words that matter are the search of Forge, limited to jComponent', mcp.calls.filter(c => c.tool === 'search').length === 1 && mcp.calls[0].input.query === 'custom jcomponent component' && mcp.calls[0].input.product === 'jcomponent');
	check('the routing drops the filler words in Spanish and English', MODS.knowledge.route('quiero hacer un componente jcomponent').query === 'custom component jcomponent' && MODS.knowledge.route('quiero hacer un componente jcomponent').product === 'jcomponent' && MODS.knowledge.route('how to create a NEWACTION with input').product === 'total5' && MODS.knowledge.route('fix the button').product === '');
	check('the best two pages are read', mcp.calls.filter(c => c.tool === 'page').length === 2 && mcp.calls.filter(c => c.tool === 'page')[0].input.slug === 'custom-component');
	check('their text is in the system prompt', system.indexOf('PAGE custom-component: a component is declared') !== -1 && system.indexOf('PAGE component-lifecycle') !== -1 && system.indexOf('Pages of Forge') !== -1);
	check('the other results are listed for the page tool', system.indexOf('Extra page (docs extra-page)') !== -1);

	var r = await api('sessions_messages/' + id);
	var knowledge = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'knowledge');
	check('the conversation shows what was used: the recipe of Totem and the two pages', knowledge && knowledge.data.pages.length === 3 && knowledge.data.pages[0].url === '' && /jComponent 20 component/.test(knowledge.data.pages[0].title) && knowledge.data.pages[1].url.indexOf('https://forge.totaljs.es') === 0);

	// A greeting is not worth a search
	events.length = 0;
	requests.length = 0;
	mcp.calls.length = 0;
	script = [{ content: 'Hi.' }];
	approver = setInterval(() => events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'once' })), 30);
	await api('sessions_prompt/' + id, { text: 'hola' });
	await idle(id);
	clearInterval(approver);
	check('a short prompt does not search', mcp.calls.length === 0 && requests[0].messages[0].content.indexOf('Pages of Forge') === -1);

	// It can be switched off
	CONF.forgepages = 0;
	events.length = 0;
	mcp.calls.length = 0;
	script = [{ content: 'Done.' }];
	approver = setInterval(() => events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'once' })), 30);
	await api('sessions_prompt/' + id, { text: 'how do I write a custom jcomponent component' });
	await idle(id);
	clearInterval(approver);
	CONF.forgepages = 2;
	check('forgepages 0 turns the prefetch off', mcp.calls.length === 0);
	Total.Fs.unlinkSync(Total.Path.join(tjs, '.totem/mcp.json'));
	next();
});

Test.push('LiteLLM', async function(next) {

	var r = await api('providers_templates');
	var litellm = r.response.find(t => t.id === 'litellm');
	check('LiteLLM is a template with the port of the proxy, searched for on this computer but not presented as local', litellm && litellm.kind === 'litellm' && litellm.url === 'http://127.0.0.1:4000/v1' && litellm.detect === true && litellm.local === false && litellm.icon === 'litellm');
	check('the other providers of the list are templates too', ['vllm', 'xai', 'fireworks', 'cerebras', 'huggingface', 'nvidia', 'moonshot', 'cohere'].every(id => r.response.find(t => t.id === id)));

	r = await api('providers_available', { url: 'http://127.0.0.1:8111/v1', kind: 'litellm' });
	var by = {};
	r.response.forEach(m => by[m.id] = m);
	check('LiteLLM lists each model once, with its context, tools, reasoning and price', r.response.length === 3 && by['gpt-a'].context === 128000 && by['gpt-a'].tools === true && by['gpt-a'].reasoning === false && by['gpt-a'].free === false && by['gpt-a'].price.input === 0.000001 && by['gpt-a'].price.output === 0.000002);
	check('a model with no cost is free and a model with no information has nulls', by['local-b'].free === true && by['local-b'].tools === false && by['local-b'].context === 8192 && by['unknown-c'].tools === null && by['unknown-c'].context === null && by['unknown-c'].price === null);
	check('LiteLLM gives the model behind the name, and a gateway name does not hide a small model', by['gpt-a'].underlying === 'openai/gpt-4o' && by['unknown-c'].underlying === null && (function() {
		MAIN.modelmeta['gw:qwen-local'] = { underlying: 'ollama/qwen2.5:1.5b' };
		MAIN.modelmeta['gw:big'] = { underlying: 'openai/gpt-4o' };
		var ok = MODS.agent.smallmodel('gw:qwen-local') && !MODS.agent.smallmodel('gw:big') && !MODS.agent.smallmodel('gw:nothing');
		delete MAIN.modelmeta['gw:qwen-local'];
		delete MAIN.modelmeta['gw:big'];
		return ok;
	})());
	next();
});

Test.push('sessions: name, rename, delete', async function(next) {

	check('a title is one short line without markup', FUNC.title('  **Fix** the `login` bug\nand more') === 'Fix the login bug' && FUNC.title('x'.repeat(80)).length === 48 && FUNC.title('x'.repeat(80)).slice(-1) === '…' && FUNC.title('') === '');

	// A name given at creation stays
	var r = await api('sessions_create', { projectid: projectid, model: 'fake', name: '  My own name  ' });
	var named = r.response;
	check('a session can be named when it is created', named.name === 'My own name' && named.named === true);
	events.length = 0;
	script = [{ content: 'ok' }];
	await api('sessions_prompt/' + named.id, { text: 'something completely different' });
	await idle(named.id);
	r = await api('sessions_read/' + named.id);
	check('the first prompt does not change a name of the user', r.response.name === 'My own name');

	// Without a name the first prompt gives one
	r = await api('sessions_create', { projectid: projectid, model: 'fake' });
	check('without a name the session has the default one', r.response.name === 'New session' && r.response.named === false);
	var auto = r.response.id;
	events.length = 0;
	script = [{ content: 'ok' }, { content: 'again' }];
	await api('sessions_prompt/' + auto, { text: 'Fix the login bug please\nthe details are below' });
	await idle(auto);
	r = await api('sessions_read/' + auto);
	check('the first prompt names the session', r.response.name === 'Fix the login bug please' && events.some(e => e.type === 'session.updated' && e.data.session.name === 'Fix the login bug please'));
	events.length = 0;
	await api('sessions_prompt/' + auto, { text: 'a second prompt' });
	await idle(auto);
	r = await api('sessions_read/' + auto);
	check('the second prompt does not rename it', r.response.name === 'Fix the login bug please');

	// Rename
	events.length = 0;
	r = await api('sessions_update/' + auto, { name: '  Login work  ' });
	check('a session can be renamed', r.response.success === true && events.some(e => e.type === 'session.updated' && e.data.session.name === 'Login work'));
	r = await api('sessions_read/' + auto);
	check('the new name is kept and counts as a name of the user', r.response.name === 'Login work' && r.response.named === true);
	r = await api('sessions_update/' + auto, { name: '   ' });
	check('an empty name is refused', !!(r.err && r.err.items && r.err.items[0].error));
	r = await api('sessions_update/nope', { name: 'x' });
	check('a session that does not exist is a 404', !!(r.err && r.err.items));

	// Delete
	r = await api('sessions_remove/' + auto);
	check('a session can be deleted', r.response.success === true);
	r = await api('sessions_read/' + auto);
	check('a deleted session is gone', !!(r.err && r.err.items));
	r = await api('sessions_messages/' + auto);
	check('its messages are gone too', Array.isArray(r.response) && r.response.length === 0);
	r = await api('sessions?projectid=' + projectid);
	check('the project no longer lists it', !r.response.some(s => s.id === auto) && r.response.some(s => s.id === named.id));
	next();
});

Test.push('attachments', async function(next) {

	var mock = require('./mock-openai');
	var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
	var note = Buffer.from('hello notes').toString('base64');
	var dir = Total.Path.join(TMP, 'databases', 'attachments');

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Seen.' }, { content: 'Again.' }];
	var r = await api('sessions_prompt/' + id, { text: 'look at these', attachments: [{ name: 'a.png', mime: 'image/png', data: PNG }, { name: 'notes.md', mime: 'text/markdown', data: note }] });
	check('a prompt with files is accepted', !!(r.response && r.response.messageid));
	await idle(id);

	var content = requests[0].messages[requests[0].messages.length - 1].content;
	check('the text file goes into the prompt, the image goes as a data URL', Array.isArray(content) && content[0].text.indexOf('look at these') === 0 && content[0].text.indexOf('<file name="notes.md">\nhello notes\n</file>') !== -1 && content[1].type === 'image_url' && content[1].image_url.url === 'data:image/png;base64,' + PNG);

	r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'user').parts;
	var files = parts.filter(p => p.type === 'file');
	check('the conversation keeps a part per file with its metadata and no content', files.length === 2 && files[0].data.kind === 'image' && files[0].data.name === 'a.png' && files[1].data.kind === 'text' && files[1].data.size === 11 && JSON.stringify(files).indexOf(PNG) === -1);
	check('the files are kept on disk', Total.Fs.readdirSync(dir).length === 2);

	// The history sends the files again in the next turn
	await api('sessions_prompt/' + id, { text: 'and now?' });
	await idle(id);
	var earlier = requests[1].messages.find(m => Array.isArray(m.content));
	check('the next turn still has the image of the first one', !!earlier && earlier.content[1].image_url.url.indexOf('data:image/png;base64,') === 0);

	// The files can be read back
	var get = (url) => new Promise(resolve => Total.Http.get(url, function(res) {
		var chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ type: res.headers['content-type'], body: Buffer.concat(chunks), status: res.statusCode }));
	}));
	var image = await get('http://127.0.0.1:' + PORT + '/attachments/' + files[0].data.id + '/');
	var text = await get('http://127.0.0.1:' + PORT + '/attachments/' + files[1].data.id + '/');
	check('an image is served with its type', image.status === 200 && image.type === 'image/png' && image.body.toString('base64') === PNG);
	check('a text file is served as plain text', text.status === 200 && /^text\/plain/.test(text.type) && text.body.toString() === 'hello notes');
	var missing = await get('http://127.0.0.1:' + PORT + '/attachments/nope/');
	check('a file that does not exist is a 404', missing.status === 404);

	// What cannot be attached
	var before = (await api('sessions_messages/' + id)).response.length;
	var bad = async (attachments) => (await api('sessions_prompt/' + id, { text: 'x', attachments: attachments })).err;
	check('a program is refused', !!(await bad([{ name: 'x.exe', mime: 'application/octet-stream', data: note }])));
	check('a binary file named .txt is refused', !!(await bad([{ name: 'b.txt', mime: 'text/plain', data: Buffer.from([65, 0, 66]).toString('base64') }])));
	check('too many files are refused', !!(await bad([1, 2, 3, 4, 5, 6, 7].map(i => ({ name: 'f' + i + '.txt', mime: 'text/plain', data: note })))));
	check('a text file over the limit is refused', !!(await bad([{ name: 'big.txt', mime: 'text/plain', data: Buffer.alloc(201 * 1024, 65).toString('base64') }])));
	check('an image over the limit is refused', !!(await bad([{ name: 'big.png', mime: 'image/png', data: Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64') }])));
	check('a refused prompt leaves no message', (await api('sessions_messages/' + id)).response.length === before);

	// A model that cannot see gets the text and a note
	var base = 'http://127.0.0.1:8111/v1';
	await api('providers_save', { name: 'No vision', url: base, kind: 'openai', models: ['m'], meta: { m: { id: 'm', vision: false, tools: true } } });
	await new Promise(resolve => setTimeout(resolve, 200));
	var blind = await session({ model: 'no-vision:m' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + blind, { text: 'what is in this picture', attachments: [{ name: 'a.png', mime: 'image/png', data: PNG }] });
	await idle(blind);
	var last = mock.requests[0].messages[mock.requests[0].messages.length - 1].content;
	check('a model that cannot see gets a text and a note instead of the image', typeof(last) === 'string' && last.indexOf('what is in this picture') === 0 && last.indexOf('1 image omitted') !== -1);

	var cat = (await api('providers_catalog')).response.find(m => m.id === 'no-vision:m');
	check('the catalogue says if a model can see', cat.vision === false);

	// The format of the other providers
	var multi = [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG } }] }];
	var a = MODS.provider.toanthropic(multi).messages[0].content;
	var g = MODS.provider.togemini(multi).contents[0].parts;
	check('Anthropic receives the image as a base64 block', a[0].type === 'text' && a[1].type === 'image' && a[1].source.type === 'base64' && a[1].source.media_type === 'image/png' && a[1].source.data === PNG);
	check('Gemini receives the image as inline data', g[0].text === 'hi' && g[1].inlineData.mimeType === 'image/png' && g[1].inlineData.data === PNG);

	// A server that refuses images, with no flag in its metadata: the prompt is tried again without them
	await api('providers_save', { name: 'Refuses', url: base, kind: 'openai', models: ['noimg'] });
	await new Promise(resolve => setTimeout(resolve, 200));
	var refusing = await session({ model: 'refuses:noimg' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + refusing, { text: 'describe it', attachments: [{ name: 'a.png', mime: 'image/png', data: PNG }] });
	await idle(refusing);
	check('a refusal of images is retried without them', mock.requests.length === 2 && Array.isArray(mock.requests[0].messages[mock.requests[0].messages.length - 1].content) && typeof(mock.requests[1].messages[mock.requests[1].messages.length - 1].content) === 'string' && events.some(e => e.type === 'error' && e.data.retry === true && /cannot read images/.test(e.data.message)));
	check('the run still ends well and the model is remembered as blind', !events.some(e => e.type === 'session.status' && e.data.status === 'error') && MAIN.modelmeta['refuses:noimg'].vision === false);
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + refusing, { text: 'again', attachments: [{ name: 'b.png', mime: 'image/png', data: PNG }] });
	await idle(refusing);
	check('the next prompt does not send the images at all', mock.requests.length === 1 && typeof(mock.requests[0].messages[mock.requests[0].messages.length - 1].content) === 'string');

	// Adding a provider that exists refreshes it
	await api('providers_save', { name: 'Twice', url: base, kind: 'openai', models: ['one'] });
	await api('providers_save', { name: 'Twice', url: base, kind: 'openai', models: ['one', 'two'] });
	var twice = (await api('providers')).response.filter(p => p.id === 'twice');
	check('a provider added twice is one provider with the new models', twice.length === 1 && twice[0].models.length === 2);

	// Deleting the session deletes its files
	await api('sessions_remove/' + id);
	check('deleting the session deletes its files', Total.Fs.readdirSync(dir).length === 0 || Total.Fs.readdirSync(dir).every(name => name !== files[0].data.id && name !== files[1].data.id));
	next();
});

Test.push('a client that opens the session later sees what it waits for', async function(next) {

	var id = await session();
	events.length = 0;
	script = [{ tools: [{ id: 'p1', name: 'write', arguments: { path: 'later.txt', content: 'x' } }] }, { content: 'done' }];
	await api('sessions_prompt/' + id, { text: 'write it' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask' && e.sessionid === id));

	// A new connection, after the question was sent to the ones that were open
	var received = [];
	var ws = new WebSocket('ws://127.0.0.1:' + PORT + '/api/');
	ws.onmessage = e => received.push(JSON.parse(e.data));
	await new Promise(resolve => ws.onopen = resolve);
	ws.send(JSON.stringify({ type: 'subscribe', sessionid: id }));
	var replayed = await until(() => received.find(m => m.type === 'permission.ask'));
	check('a new client receives the question that is waiting', !!replayed && replayed.data.id === ask.data.id && replayed.data.tool === 'write' && replayed.sessionid === id);

	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await idle(id);

	var other = [];
	var ws2 = new WebSocket('ws://127.0.0.1:' + PORT + '/api/');
	ws2.onmessage = e => other.push(JSON.parse(e.data));
	await new Promise(resolve => ws2.onopen = resolve);
	ws2.send(JSON.stringify({ type: 'subscribe', sessionid: id }));
	await new Promise(resolve => setTimeout(resolve, 300));
	check('once it is answered nothing is replayed', !other.some(m => m.type === 'permission.ask'));
	ws.close();
	ws2.close();
	next();
});

Test.push('restart', async function(next) {

	// A session that was running when the server stopped
	var id = await session();
	await NOSQL('sessions').modify({ status: 'running' }).where('id', id).promise();
	var count = await new Promise(resolve => FUNC.recover(resolve));
	var r = await api('sessions_read/' + id);
	check('a session that was running before a restart is marked as aborted', count >= 1 && r.response.status === 'aborted');
	next();
});

Test.push('the icons of the providers are all the same', function(next) {

	var normalizer = require('../scripts/normalize-icons');
	var dir = Total.Path.join(ROOT, 'public/img/providers');
	var files = Total.Fs.readdirSync(dir).filter(name => /\.svg$/.test(name));

	// The path parser: relative and absolute commands, an arc with its flags stuck to the numbers, a closed shape
	var box = normalizer.bounds('M2 3h4v5H2z');
	check('the bounds of a path of lines', box.x0 === 2 && box.y0 === 3 && box.x1 === 6 && box.y1 === 8);
	box = normalizer.bounds('M0 0a5 5 0 1010 0');
	check('the bounds of an arc whose flags are stuck to the numbers', Math.abs(box.x1 - 10) < 0.01 && Math.abs(box.x0) < 0.01 && Math.abs((box.y1 - box.y0) - 5) < 0.2);
	box = normalizer.bounds('M0 0C0 10 10 10 10 0');
	check('the bounds of a curve are the curve, not its control points', box.y1 > 7 && box.y1 < 8);

	check('there is an icon for every template that names one', JSON.parse(Total.Fs.readFileSync(Total.Path.join(ROOT, 'private/providers.json'), 'utf8')).filter(t => t.icon).every(t => files.indexOf(t.icon + '.svg') !== -1));

	var wrong = [];
	files.forEach(function(name) {
		var text = Total.Fs.readFileSync(Total.Path.join(dir, name), 'utf8');
		var root = text.match(/<svg[^>]*>/)[0];
		var transform = text.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
		var paths = (text.match(/\sd="([^"]+)"/g) || []).map(d => d.slice(4, -1));
		var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
		paths.forEach(d => { var p = normalizer.bounds(d); b.x0 = Math.min(b.x0, p.x0); b.y0 = Math.min(b.y0, p.y0); b.x1 = Math.max(b.x1, p.x1); b.y1 = Math.max(b.y1, p.y1); });
		var x0 = b.x0 * transform[3] + +transform[1], x1 = b.x1 * transform[3] + +transform[1], y0 = b.y0 * transform[3] + +transform[2], y1 = b.y1 * transform[3] + +transform[2];
		var longest = Math.max(x1 - x0, y1 - y0);
		var centered = Math.abs((x0 + x1) / 2 - 12) < 0.05 && Math.abs((y0 + y1) / 2 - 12) < 0.05;
		var ok = /viewBox="0 0 24 24"/.test(root) && /fill="currentColor"/.test(root) && !/\s(width|height|style|class)=/.test(text) && !/<path[^>]*\sfill="/.test(text) && Math.abs(longest - 20) < 0.05 && centered && x0 >= 1.95 && y0 >= 1.95 && x1 <= 22.05 && y1 <= 22.05;
		!ok && wrong.push(name);
	});
	check('every icon has the same box, colour and size, and is centered' + (wrong.length ? ' (not: ' + wrong.join(', ') + ')' : ''), wrong.length === 0);
	next();
});

Test.push('small models: temperature, reminder, and Forge for every project', async function(next) {

	var mock = require('./mock-openai');
	var mcp = require('./mock-mcp');

	check('the servers of this computer are recognized', ['http://127.0.0.1:11434/v1', 'http://localhost:4000/v1', 'http://192.168.1.5:8080/v1', 'http://10.0.0.2/v1', 'http://172.20.1.1/v1', 'http://[::1]:8080/v1'].every(u => MODS.provider.islocal(u)));
	check('a remote provider is not', ['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'http://172.32.0.1/v1', 'https://localhost.example.com/v1', ''].every(u => !MODS.provider.islocal(u)));

	// Temperature: a low one for a server of this computer
	var id = await session({ model: 'mock:mock' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	check('a model of this computer is asked for the temperature of the config', mock.requests[0].temperature === 0.2);

	// A gateway (LiteLLM) in front of Ollama: the window and the limit of a small model go in the request, which the gateway passes on
	await api('providers_save', { name: 'Gateway', url: 'http://127.0.0.1:8111/v1', kind: 'litellm', models: ['small', 'big'], meta: { small: { id: 'small', underlying: 'ollama_chat/qwen2.5:1.5b' }, big: { id: 'big', underlying: 'openai/gpt-4o' } } });
	await new Promise(resolve => setTimeout(resolve, 200));
	var gw = await session({ model: 'gateway:small' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + gw, { text: 'hello there' });
	await idle(gw);
	check('Ollama behind a gateway gets its window and the limit of a small model', mock.requests[0].num_ctx === 16384 && mock.requests[0].repeat_penalty === 1.1 && mock.requests[0].max_tokens === CONF.ollamapredictsmall);
	var gb = await session({ model: 'gateway:big' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + gb, { text: 'hello there' });
	await idle(gb);
	check('and another model behind the gateway gets neither', mock.requests[0].num_ctx === undefined && mock.requests[0].max_tokens === undefined);

	// The reminder goes in the request of a Total.js project, and only there
	var fresh = Total.Path.join(TMP, 'fresh2');
	Total.Fs.mkdirSync(fresh, { recursive: true });
	var project = (await api('projects_open', { path: fresh })).response;
	var tid = (await api('sessions_create', { projectid: project.id, model: 'fake' })).response.id;
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	var rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	await api('sessions_prompt/' + tid, { text: 'a form with jcomponent' });
	await idle(tid);
	clearInterval(rejecter);
	var last = requests[0].messages[requests[0].messages.length - 1];
	check('the prompt of a Total.js project ends with the reminder', last.role === 'user' && last.content.indexOf('a form with jcomponent') === 0 && /Total\.js 5 and jComponent 20.*interface library of Total.js/s.test(last.content) && /TABS/.test(last.content));
	var stored = (await api('sessions_messages/' + tid)).response.find(m => m.role === 'user').parts[0].data;
	check('the reminder is not stored: the user sees only what they wrote', stored.text === 'a form with jcomponent' && JSON.stringify(stored).indexOf('Not plain JavaScript') === -1);

	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	var plain = (await api('sessions_create', { projectid: projectid, model: 'fake' })).response.id;
	await api('sessions_prompt/' + plain, { text: 'a form with jcomponent' });
	await idle(plain);
	check('a plain Node.js project has no reminder', requests[0].messages[requests[0].messages.length - 1].content === 'a form with jcomponent');

	// A question about the server does not mention the interface
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	await api('sessions_prompt/' + tid, { text: 'show me a route that answers GET /hello' });
	await idle(tid);
	clearInterval(rejecter);
	last = requests[0].messages[requests[0].messages.length - 1];
	check('a question about a route gets the reminder of the style and no word of jComponent', /TABS/.test(last.content) && /ES5/.test(last.content) && !/jComponent/.test(last.content) && /use tools only to read or change files/i.test(last.content));

	// A greeting and a command do not get "answer with the code" (the permission to start Forge is rejected, as above)
	rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Hola' }];
	await api('sessions_prompt/' + tid, { text: 'Hola' });
	await idle(tid);
	check('a greeting does not get the reminder', requests[0].messages[requests[0].messages.length - 1].content === 'Hola');
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	await api('sessions_prompt/' + tid, { text: '/init' });
	await idle(tid);
	check('a command does not get the reminder', !/TABS|Total\.js 5/.test(requests[0].messages[requests[0].messages.length - 1].content));
	clearInterval(rejecter);

	// A model that says nothing (the server swallowed a broken tool call) gets the same request without tools, once
	events.length = 0;
	requests.length = 0;
	script = [{ content: '' }, { content: 'The answer.' }];
	rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	await api('sessions_prompt/' + tid, { text: 'how do I write a route' });
	await idle(tid);
	clearInterval(rejecter);
	check('an empty answer is asked again without tools', requests.length === 2 && requests[0].tools && requests[0].tools.length > 0 && (!requests[1].tools || requests[1].tools.length === 0));
	check('the empty answer is not kept in the conversation', !requests[1].messages.some(m => m.role === 'assistant' && !m.content && !m.tool_calls));
	r = await api('sessions_messages/' + tid);
	check('and the person sees the answer', r.response.filter(m => m.role === 'assistant').pop().parts.some(p => p.type === 'text' && p.data.text === 'The answer.'));

	// The next request has its tools again
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Second.' }];
	rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
	await api('sessions_prompt/' + tid, { text: 'and another route' });
	await idle(tid);
	clearInterval(rejecter);
	check('the next prompt has its tools again', requests[0].tools && requests[0].tools.length > 0);

	// The code of an answer is checked and the model corrects it once
	function bad(code) {
		return 'Here it is:\n\n```js\n' + code + '\n```';
	}

	var spaces = bad("exports.install = function() {\n    ROUTE('GET /hello', function($) {\n        $.plain('Hello');\n    });\n};");
	var tabs = bad("exports.install = function() {\n\tROUTE('GET /hello', function($) {\n\t\t$.plain('Hello');\n\t});\n};");

	async function ask(text, answers) {
		events.length = 0;
		requests.length = 0;
		script = answers.map(content => ({ content: content }));
		var rejecter = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' })), 30);
		await api('sessions_prompt/' + tid, { text: text });
		await idle(tid);
		clearInterval(rejecter);
	}

	await ask('show me a route that answers GET /hello', [spaces, tabs]);
	check('spaces in code indentation are repaired without another model request', requests.length === 1);
	r = await api('sessions_messages/' + tid);
	var parts = r.response.filter(m => m.role === 'assistant').pop().parts;
	check('the normalized answer is the only text part', parts.filter(p => p.type === 'text').length === 1);
	check('a model of up to 4 billion parameters is known by its name', MODS.agent.smallmodel('ollama:qwen2.5:1.5b') && MODS.agent.smallmodel('local:llama3.2:3b') && MODS.agent.smallmodel('x:phi3:3.8b') && !MODS.agent.smallmodel('ollama:qwen2.5:7b') && !MODS.agent.smallmodel('openai:gpt-4o') && !MODS.agent.smallmodel('fake'));
	check('the conversation says that the code was checked, and has the corrected answer', parts.filter(p => p.type === 'text').pop().data.text.indexOf('\t\t$.plain') !== -1);

	await ask('show me a route that answers GET /hello', [bad('var a = (;'), bad('var a = (;'), 'never']);
	check('it asks only once: a second answer is checked and marked for review', requests.length === 2);
	r = await api('sessions_messages/' + tid);
	parts = r.response.filter(m => m.role === 'assistant').pop().parts;
	check('only one final version is stored, without the correction request', parts.filter(p => p.type === 'text').length === 1 && !parts.some(p => p.type === 'text' && /Totem checked/.test(p.data.text)) && parts.some(p => p.type === 'validation' && p.data.blocking === true));
	check('the draft is never published to the client', !events.some(e => e.type === 'part.delta' && /Here it is|ROUTE/.test(e.data.text)) && events.filter(e => e.type === 'part.created' && e.data.part.type === 'text' && e.data.part.messageid === parts.find(p => p.type === 'text').messageid).length === 1);

	var warning = bad("NEWACTION('Hello|read', { action: function($) { $.invalid('Plain error'); } });");
	await ask('show me a route that answers GET /hello', [warning, warning]);
	r = await api('sessions_messages/' + tid);
	parts = r.response.filter(m => m.role === 'assistant').pop().parts;
	check('a remaining translation warning allows the user to save explicitly', parts.some(p => p.type === 'validation' && p.data.blocking === false));

	await ask('show me a route that answers GET /hello', [tabs]);
	check('clean code is not asked again', requests.length === 1);

	await ask('show me a route that answers GET /hello', [bad("exports.install = function() {\n\tNEWUSER('x');\n\tSEND_ALL('y');\n};"), tabs]);
	check('an invented function is reported, with its name', requests.length === 2 && /NEWUSER\(\) does not exist/.test(requests[1].messages[requests[1].messages.length - 1].content) && /SEND_ALL\(\) does not exist/.test(requests[1].messages[requests[1].messages.length - 1].content));

	await ask('show me a route that answers GET /hello', [bad("var a = (;"), tabs]);
	check('a syntax error is reported', requests.length === 2 && /syntax/.test(requests[1].messages[requests[1].messages.length - 1].content));

	await ask('show me a route that answers GET /hello', [bad("var items = [];\nITEMS.push(1);\nvar x = UID();\nvar y = NOW;"), tabs]);
	check('the globals of Total.js are not reported', requests.length === 1 || !/UID\(\) does not exist/.test(requests[1].messages[requests[1].messages.length - 1].content));

	CONF.selfcheck = false;
	await ask('show me a route that answers GET /hello', [spaces]);
	CONF.selfcheck = true;
	check('selfcheck false turns it off', requests.length === 1);

	events.length = 0;
	requests.length = 0;
	script = [{ content: spaces }];
	var plainid = (await api('sessions_create', { projectid: projectid, model: 'fake' })).response.id;
	await api('sessions_prompt/' + plainid, { text: 'show me a route that answers GET /hello' });
	await idle(plainid);
	check('a project that is not Total.js is left alone', requests.length === 1);

	// Always allow Forge once, for every project
	var a = Total.Path.join(TMP, 'forge-a');
	var b = Total.Path.join(TMP, 'forge-b');
	[a, b].forEach(function(dir) {
		Total.Fs.mkdirSync(Total.Path.join(dir, '.totem'), { recursive: true });
		Total.Fs.writeFileSync(Total.Path.join(dir, 'package.json'), '{ "dependencies": { "total5": "latest" } }');
		Total.Fs.writeFileSync(Total.Path.join(dir, '.totem/mcp.json'), JSON.stringify({ servers: { forge: { url: 'http://127.0.0.1:8111/mcp' } } }));
	});

	var pa = (await api('projects_open', { path: a })).response;
	var sa = (await api('sessions_create', { projectid: pa.id, model: 'fake' })).response.id;
	events.length = 0;
	script = [{ content: 'ok' }];
	var always = setInterval(() => events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'always' })), 30);
	await api('sessions_prompt/' + sa, { text: 'how do I write a jcomponent' });
	await idle(sa);
	clearInterval(always);
	var rule = await NOSQL('permissions').read().where('tool', 'mcp-start').promise();
	check('"Always allow" for Forge is stored for every project', !!rule && rule.projectid === '' && rule.pattern.indexOf('forge: ') === 0);

	var pb = (await api('projects_open', { path: b })).response;
	var sb = (await api('sessions_create', { projectid: pb.id, model: 'fake' })).response.id;
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	await api('sessions_prompt/' + sb, { text: 'how do I write a jcomponent' });
	await idle(sb);
	check('another project starts Forge without asking again', !events.some(e => e.type === 'permission.ask') && requests[0].tools.some(t => t.function.name === 'forge__Forge_search'));
	next();
});

Test.push('Ollama with its own API', async function(next) {

	var mock = require('./mock-openai');
	var mcp = require('./mock-mcp');
	var base = 'http://127.0.0.1:8111/v1';
	var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

	await api('providers_save', { name: 'Native', url: base, kind: 'ollama', models: ['m1', 'think', 'broken'], meta: { m1: { id: 'm1', context: 32768, tools: true, vision: true }, think: { id: 'think', context: 8192, reasoning: true, tools: true }, broken: { id: 'broken', context: 8192 } } });
	await new Promise(resolve => setTimeout(resolve, 300));

	// The conversion of the messages
	var converted = MODS.provider.toollama([
		{ role: 'system', content: 'SYS' },
		{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG } }] },
		{ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }] },
		{ role: 'tool', tool_call_id: 'c1', content: 'text of a' }
	]);
	check('the images go in a list of base64 texts and the text stays', converted[1].content === 'look' && converted[1].images.length === 1 && converted[1].images[0] === PNG);
	check('the arguments of a call are an object and a result names its tool', converted[2].tool_calls[0].function.arguments.path === 'a' && converted[3].role === 'tool' && converted[3].tool_name === 'read');

	// The size of the context
	check('a small request asks for the context of the config', MODS.provider.contextsize([{ role: 'user', content: 'hi' }], [], { context: 262144 }) === 16384);
	check('a large request asks for more, in steps of 4096', MODS.provider.contextsize([{ role: 'user', content: 'x'.repeat(80000) }], [], { context: 262144 }) % 4096 === 0 && MODS.provider.contextsize([{ role: 'user', content: 'x'.repeat(80000) }], [], { context: 262144 }) > 16384);
	check('it never asks for more than the window of the model or the config', MODS.provider.contextsize([{ role: 'user', content: 'x'.repeat(900000) }], [], { context: 262144 }) === 32768 && MODS.provider.contextsize([{ role: 'user', content: 'hi' }], [], { context: 8192 }) === 8192);

	// A plain prompt goes to /api/chat
	var id = await session({ model: 'native:m1' });
	events.length = 0;
	mock.native.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	var sent = mock.native[0];
	check('Ollama gets /api/chat with a real context and the temperature of the config', mock.native.length === 1 && mock.requests.length === 0 && sent.stream === true && sent.options.num_ctx >= 16384 && sent.options.temperature === 0.2 && sent.options.repeat_penalty === 1.1 && sent.options.num_predict === 8192 && sent.messages[0].role === 'system' && sent.tools.length === 13);
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the answer and the usage of the request are kept', parts.find(p => p.type === 'text').data.text === 'Hello from Ollama' && parts.find(p => p.type === 'step').data.tokens.input === 42 && parts.find(p => p.type === 'step').data.tokens.output === 7);

	// A tool call, with the thinking of the model
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + id, { text: 'please read the file' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	parts = r.response[r.response.length - 1].parts;
	check('the thinking, the text and the tool call of Ollama are parsed', parts.some(p => p.type === 'reasoning' && p.data.text === 'I should read the file first.') && parts.find(p => p.type === 'tool').data.tool === 'read' && parts.find(p => p.type === 'tool').data.status === 'done');
	var second = mock.native[1].messages[mock.native[1].messages.length - 1];
	check('the next request carries the result with the name of the tool', mock.native.length === 2 && second.role === 'tool' && second.tool_name === 'read');
	check('the answer follows the result', parts.filter(p => p.type === 'text').map(p => p.data.text).join('|').indexOf('Ollama saw read') !== -1);

	// A long prompt gets a larger context
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + id, { text: 'word '.repeat(30000) });
	await idle(id);
	check('a request that does not fit in the usual context asks for a larger one', mock.native[0].options.num_ctx > 16384 && mock.native[0].options.num_ctx <= 32768 && mock.native[0].options.num_ctx % 4096 === 0);

	// A model with a small window is never asked for more
	var small = await session({ model: 'native:think' });
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + small, { text: 'hi', reasoning: 'none' });
	await idle(small);
	check('a model with a window of 8192 gets 8192', mock.native[0].options.num_ctx === 8192);
	check('"none" turns the thinking off for a model that thinks', mock.native[0].think === false);
	r = await api('sessions_messages/' + small);
	check('a model that thinks and answers at once keeps its text', r.response[r.response.length - 1].parts.some(p => p.type === 'text' && p.data.text === 'Hello from Ollama') && !r.response[r.response.length - 1].parts.some(p => p.type === 'reasoning'));
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + small, { text: 'leaky one', reasoning: 'none' });
	await idle(small);
	r = await api('sessions_messages/' + small);
	parts = r.response[r.response.length - 1].parts;
	check('thoughts that end with </think> in the text become reasoning, not text', parts.some(p => p.type === 'reasoning' && p.data.text === 'Hmm, the user wants a plan.') && parts.some(p => p.type === 'text' && p.data.text === 'The real answer') && !parts.some(p => p.type === 'text' && /think>/.test(p.data.text)));
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + small, { text: 'hi again', reasoning: 'high' });
	await idle(small);
	check('another level turns it on', mock.native[0].think === true);
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + id, { text: 'no flag for this one', reasoning: 'none' });
	await idle(id);
	check('a model that is not known to think gets no flag', mock.native[0].think === undefined);

	// An image goes to a model that can see
	events.length = 0;
	mock.native.length = 0;
	await api('sessions_prompt/' + id, { text: 'what is this', attachments: [{ name: 'a.png', mime: 'image/png', data: PNG }] });
	await idle(id);
	var chats = mock.native.filter(n => !JSON.stringify(n.messages).includes('Summarize'));
	var withimg = chats.filter(n => n.messages.some(m => m.images && m.images[0] === PNG));
	var lastuser = withimg.length ? withimg[0].messages.filter(m => m.images)[0] : {};
	check('an attached image is sent as an image of the message', lastuser.role === 'user' && lastuser.images && lastuser.images[0] === PNG);

	// An error of Ollama is an error of the run
	var broken = await session({ model: 'native:broken' });
	events.length = 0;
	await api('sessions_prompt/' + broken, { text: 'hello' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('the error of Ollama reaches the user with its status', events.some(e => e.type === 'error' && /400/.test(e.data.message) && /image input/.test(e.data.message)));

	// A server can offer fewer tools than it has
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/mcp.json'), JSON.stringify({ servers: { mock: { command: process.execPath, args: [Total.Path.join(ROOT, 'tests/mock-mcp.js')], tools: ['echo'] } } }));
	var filtered = await session({ model: 'fake' });
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	var approver = setInterval(() => events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'once' })), 30);
	await api('sessions_prompt/' + filtered, { text: 'hello' });
	await idle(filtered);
	clearInterval(approver);
	var names = requests[0].tools.map(t => t.function.name).filter(n => /^mock__/.test(n));
	check('only the tools that the config lists are offered', JSON.stringify(names) === JSON.stringify(['mock__echo']));
	Total.Fs.rmSync(Total.Path.join(PROJECT, '.totem'), { recursive: true });
	next();
});

Test.push('command line', async function(next) {

	function cli(args) {
		return new Promise(resolve => Total.Child.execFile(process.execPath, [Total.Path.join(ROOT, 'bin/totem.js')].concat(args), { timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout: stdout, stderr: stderr })));
	}

	var base = ['--project', PROJECT, '--model', 'mock:mock', '--url', 'http://127.0.0.1:' + PORT];
	var r = await cli(['run', 'hello there'].concat(base));
	check('totem run prints the answer and exits with 0', r.code === 0 && r.stdout.indexOf('Hello from the mock model. You said: hello there') !== -1);

	r = await cli(['run', 'please read the file'].concat(base));
	check('totem run reports tool calls on stderr', r.code === 0 && /\[read\] (done|error)/.test(r.stderr) && r.stdout.indexOf('I read the file.') !== -1);

	r = await cli(['run', 'please fail'].concat(base));
	check('totem run exits with 1 on an error', r.code === 1 && r.stderr.indexOf('401') !== -1);

	r = await cli(['run']);
	check('totem run without a prompt explains the usage', r.code === 2 && r.stderr.indexOf('Missing prompt') !== -1);

	r = await cli(['config']);
	check('totem config prints the folders', r.stdout.indexOf('Data folder:') !== -1);
	next();
});

Test.push('secrets', async function(next) {

	var id = await session();
	events.length = 0;
	script = [{ tools: [{ id: 'z1', name: 'bash', arguments: { command: 'echo secret-key and sk-abcdefghijklmnopqrstuvwxyz123456' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'leak it' });
	var permission = await until(() => events.find(e => e.type === 'permission.ask' && e.sessionid === id));
	await api('permissions_reply/' + permission.data.id, { reply: 'once' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var part = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'tool');
	check('provider keys and key-like strings never reach the output', part.data.output.indexOf('secret-key') === -1 && part.data.output.indexOf('sk-abcdefghijkl') === -1 && part.data.output.indexOf('[secret]') !== -1);
	next();
});

Test.push('Plan mode, formatter, init and secrets', async function(next) {

	// Plan mode reads and answers, it does not change anything
	var id = await session({ autoaccept: true });
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'pw', name: 'write', arguments: { path: 'plan.txt', content: 'x' } }] },
		{ content: 'The plan.' }
	];
	await api('sessions_prompt/' + id, { text: 'plan a change', mode: 'plan' });
	await idle(id);
	var names = requests[0].tools.map(t => t.function.name);
	check('plan mode does not offer the tools that change things', names.indexOf('write') === -1 && names.indexOf('edit') === -1 && names.indexOf('patch') === -1 && names.indexOf('bash') === -1 && names.indexOf('read') !== -1);
	check('plan mode adds its instructions', requests[0].messages[0].content.indexOf('PLAN mode') !== -1);
	check('a write in plan mode is refused, even with auto-accept', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'plan.txt')) && requests[1].messages.some(m => m.role === 'tool' && /Plan mode/.test(m.content)));
	var r = await api('sessions_read/' + id);
	check('the mode is kept in the session', r.response.mode === 'plan');

	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'bw', name: 'write', arguments: { path: 'plan.txt', content: 'built' } }] }, { content: 'Built.' }];
	await api('sessions_prompt/' + id, { text: 'now build it', mode: 'build' });
	await idle(id);
	check('build mode offers every tool again', requests[0].tools.some(t => t.function.name === 'write') && requests[0].messages[0].content.indexOf('PLAN mode') === -1);
	check('build mode writes', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'plan.txt'), 'utf8') === 'built');

	// A formatter of the project runs after a write
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/formatters.json'), JSON.stringify({ upper: { command: ['sh', '-c', 'tr a-z A-Z < "$0" > "$0.tmp" && mv "$0.tmp" "$0"', '$FILE'], extensions: ['.fmt'] } }));
	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'fw', name: 'write', arguments: { path: 'f.fmt', content: 'abc' } }] }, { tools: [{ id: 'fn', name: 'write', arguments: { path: 'g.txt', content: 'abc' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'format' });
	await idle(id);
	check('the formatter changed the file', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'f.fmt'), 'utf8') === 'ABC');
	check('the model is told that the file was formatted', requests[1].messages.some(m => m.role === 'tool' && /Formatted with upper/.test(m.content)));
	check('another extension is left alone', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'g.txt'), 'utf8') === 'abc');

	// Diagnostics: the model hears about a broken file in the same step
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'dw1', name: 'write', arguments: { path: 'bad.js', content: 'function (' } }] },
		{ tools: [{ id: 'dw2', name: 'write', arguments: { path: 'good.js', content: 'var a = 1;\n' } }] },
		{ tools: [{ id: 'dw3', name: 'write', arguments: { path: 'bad.json', content: '{ "a": ' } }] },
		{ content: 'ok' }
	];
	await api('sessions_prompt/' + id, { text: 'diagnostics' });
	await idle(id);
	var tools = r => requests[r].messages.filter(m => m.role === 'tool').map(m => m.content).pop() || '';
	check('a broken script is reported to the model', /Problems found by node in bad\.js/.test(tools(1)) && /SyntaxError/.test(tools(1)));
	check('a valid script says nothing', !/Problems found/.test(tools(2)));
	check('a broken json file is reported', /Problems found by json in bad\.json/.test(tools(3)));
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/diagnostics.json'), JSON.stringify({ node: { command: ['sh', '-c', 'echo custom failure >&2; exit 3'], extensions: ['.js'] } }));
	check('a project check runs from .totem/diagnostics.json', /custom failure/.test(MODS.diagnostics.run(PROJECT, Total.Path.join(PROJECT, 'good.js'))));
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/diagnostics.json'), JSON.stringify({ disabled: ['node', 'json'] }));
	check('a disabled check does not run', MODS.diagnostics.run(PROJECT, Total.Path.join(PROJECT, 'bad.js')) === '' && MODS.diagnostics.run(PROJECT, Total.Path.join(PROJECT, 'bad.json')) === '');
	Total.Fs.unlinkSync(Total.Path.join(PROJECT, '.totem/diagnostics.json'));

	// /init comes with Totem
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Done.' }];
	await api('sessions_prompt/' + id, { text: '/init' });
	await idle(id);
	var last = requests[0].messages[requests[0].messages.length - 1].content;
	check('/init sends the instructions to write AGENTS.md', /AGENTS\.md/.test(last) && /Study this project/.test(last));

	// Files with secrets ask, their examples do not
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.env'), 'KEY=1\n');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.env.example'), 'KEY=\n');
	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'e1', name: 'read', arguments: { path: '.env.example' } }] }, { tools: [{ id: 'e2', name: 'read', arguments: { path: '.env' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'read env' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('reading .env asks', !!ask && ask.data.tool === 'read' && ask.data.input.path === '.env');
	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await idle(id);
	check('reading .env.example does not ask', events.filter(e => e.type === 'permission.ask').length === 1);
	next();
});

Test.push('redo, fork and background commands', async function(next) {

	var id = await session({ autoaccept: true });
	var file = Total.Path.join(PROJECT, 'redo.txt');
	Total.Fs.writeFileSync(file, 'before');
	events.length = 0;
	script = [{ tools: [{ id: 'r1', name: 'edit', arguments: { path: 'redo.txt', oldstring: 'before', newstring: 'after' } }] }, { content: 'Edited.' }];
	await api('sessions_prompt/' + id, { text: 'change it' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	check('the edit happened', Total.Fs.readFileSync(file, 'utf8') === 'after');

	r = await api('sessions_undo/' + id, { messageid: assistant.id });
	check('undo restores the file', Total.Fs.readFileSync(file, 'utf8') === 'before' && r.response.length === 1);
	r = await api('sessions_read/' + id);
	check('the session says that a redo is possible', r.response.redo === true);
	r = await api('sessions_diff/' + id);
	check('the diff is empty after the undo', r.response.length === 0);

	r = await api('sessions_redo/' + id);
	check('redo puts the change back', Total.Fs.readFileSync(file, 'utf8') === 'after' && r.response.length === 1);
	r = await api('sessions_diff/' + id);
	check('the diff and a new undo work after a redo', r.response.length === 1 && r.response[0].path === 'redo.txt');
	r = await api('sessions_redo/' + id);
	check('there is nothing left to redo', !!(r.error || (r.response && r.response.error) || !r.response || r.response.length === undefined));
	r = await api('sessions_read/' + id);
	check('the redo flag is gone', r.response.redo === false);

	await api('sessions_undo/' + id, { messageid: assistant.id });
	script = [{ content: 'A new answer.' }];
	await api('sessions_prompt/' + id, { text: 'something else' });
	await idle(id);
	r = await api('sessions_read/' + id);
	check('a new prompt forgets the redo', r.response.redo === false);

	// A fork copies the conversation up to a message
	r = await api('sessions_messages/' + id);
	var total = r.response.length;
	r = await api('sessions_fork/' + id, { messageid: assistant.id });
	var fork = r.response;
	check('a fork is a new session with the same project and model', !!fork.id && fork.id !== id && fork.projectid === projectid && fork.model === 'fake' && /\(fork\)$/.test(fork.name));
	r = await api('sessions_messages/' + fork.id);
	check('the fork has the messages up to the chosen one, with new ids', r.response.length === 2 && r.response[1].parts.length > 0 && r.response.every(m => m.id !== assistant.id) && total > 2);
	r = await api('sessions_fork/' + id, {});
	var whole = await api('sessions_messages/' + r.response.id);
	check('a fork without a message copies everything', whole.response.length === total);
	await api('sessions_remove/' + fork.id);
	await api('sessions_remove/' + r.response.id);
	r = await api('sessions_messages/' + id);
	check('removing a fork leaves the original', r.response.length === total);

	// A read-only command that is chained to another one is not read-only
	events.length = 0;
	script = [{ tools: [{ id: 'ch', name: 'bash', arguments: { command: 'echo hi; touch chained.txt' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'chain' });
	var chained = await until(() => events.find(e => e.type === 'permission.ask'));
	check('a chained command asks, even when it starts with a read-only one', !!chained);
	await api('permissions_reply/' + chained.data.id, { reply: 'reject' });
	await idle(id);
	check('and a rejected one does not run', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'chained.txt')));

	// A command in the background returns at once and can be read and stopped
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'b1', name: 'bash', arguments: { command: 'echo started; sleep 30', background: true } }] },
		{ tools: [{ id: 'b2', name: 'job', arguments: {} }] },
		{ content: 'Running.' }
	];
	var started = Date.now();
	await api('sessions_prompt/' + id, { text: 'start a server' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('a background command asks like any command', !!ask && ask.data.tool === 'bash');
	await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	await idle(id);
	check('the run ends while the command still runs', Date.now() - started < 15000 && Object.keys(MAIN.jobs).length === 1);
	var job = MAIN.jobs[Object.keys(MAIN.jobs)[0]];
	r = await api('sessions_jobs/' + id);
	check('the jobs of a session are listed with their output', r.response.length === 1 && r.response[0].id === job.id && r.response[0].status === 'running' && /started/.test(r.response[0].output));
	r = await api('sessions_jobs/' + sessionid);
	check('another session has no jobs', r.response.length === 0);
	check('the output of the job is read', job.status === 'running' && /started/.test(job.output));
	check('the model gets the job id and its first output', requests[1].messages.some(m => m.role === 'tool' && /job j[0-9A-Za-z]+/.test(m.content) && /started/.test(m.content)));
	check('the job tool lists it', requests[2].messages.some(m => m.role === 'tool' && m.content.indexOf(job.id) !== -1 && /running/.test(m.content)));

	events.length = 0;
	script = [{ tools: [{ id: 'b3', name: 'job', arguments: { id: job.id, stop: true } }] }, { content: 'Stopped.' }];
	await api('sessions_prompt/' + id, { text: 'stop it' });
	await idle(id);
	check('the job is stopped', job.status === 'stopped');

	events.length = 0;
	script = [{ tools: [{ id: 'b4', name: 'bash', arguments: { command: 'sleep 30', background: true } }] }, { content: 'again' }];
	await api('sessions_prompt/' + id, { text: 'again' });
	ask = await until(() => events.find(e => e.type === 'permission.ask'), 20000);
	await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	await idle(id);
	var live = Object.keys(MAIN.jobs).map(k => MAIN.jobs[k]).filter(j => j.status === 'running');
	check('another job runs', live.length === 1);
	await api('sessions_remove/' + id);
	check('removing the session ends its jobs', Object.keys(MAIN.jobs).length === 0);
	next();
});

Test.push('instruction files and rules of an agent', async function(next) {

	Total.Fs.mkdirSync(Total.Path.join(PROJECT, 'docs'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'docs/style.md'), 'USE TABS ALWAYS');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'docs/rules.md'), 'NO SEMICOLON JOKES');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'CONTRIB.md'), 'SMALL COMMITS');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/instructions.json'), JSON.stringify(['docs/*.md', 'CONTRIB.md', '../outside.md', 'https://example.com/x.md']));

	var text = MODS.instructions.text(PROJECT);
	check('the instruction files of the project are read, patterns included', text.indexOf('USE TABS ALWAYS') !== -1 && text.indexOf('NO SEMICOLON JOKES') !== -1 && text.indexOf('SMALL COMMITS') !== -1);
	check('a path outside the project and a URL are not read', MODS.instructions.extra(PROJECT).join(',') === 'docs/rules.md,docs/style.md,CONTRIB.md');

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	check('they reach the system prompt', requests[0].messages[0].content.indexOf('USE TABS ALWAYS') !== -1);
	Total.Fs.rmSync(Total.Path.join(PROJECT, '.totem/instructions.json'));

	// An agent can deny or allow tools by itself
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem/agents'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/agents/careful.md'), '---\nname: careful\ndescription: Writes only notes\ntools: read, write, bash\nallow: write\ndeny: bash\n---\nYou write notes.\n');
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'k1', name: 'task', arguments: { agent: 'careful', prompt: 'write a note' } }] },
		{ tools: [{ id: 'k2', name: 'write', arguments: { path: 'note.txt', content: 'n' } }, { id: 'k3', name: 'bash', arguments: { command: 'touch denied.txt' } }] },
		{ content: 'Done.' },
		{ content: 'The agent finished.' }
	];
	await api('sessions_prompt/' + id, { text: 'delegate' });
	await idle(id);
	check('a tool that the agent allows does not ask', Total.Fs.existsSync(Total.Path.join(PROJECT, 'note.txt')) && !events.some(e => e.type === 'permission.ask' && e.data.tool === 'write'));
	check('a tool that the agent denies is refused without asking', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'denied.txt')) && !events.some(e => e.type === 'permission.ask' && e.data.tool === 'bash') && requests[2].messages.some(m => m.role === 'tool' && /not allowed to use bash/.test(m.content)));
	Total.Fs.rmSync(Total.Path.join(PROJECT, '.totem/agents/careful.md'));
	next();
});

Test.push('sidebar: names and sessions', async function(next) {

	// A name that is not a text (the event of a click) is ignored
	var r = await api('sessions_create', { projectid: projectid, model: 'fake', name: { type: 'click' } });
	check('a name that is an object does not name the session', r.response && r.response.name === 'New session');
	var broken = await session({ name: 'x' });
	await NOSQL('sessions').modify({ name: '[object Object]', named: true }).where('id', broken).promise();
	var list = await api('sessions?projectid=' + projectid);
	var healed = list.response.find(x => x.id === broken);
	check('a name written by the old bug is healed when the sessions are listed', !!healed && healed.name === 'New session' && healed.named === false);
	next();
});

Test.push('the icons in use exist in the icon font', function(next) {

	// tests/icons.txt is the list of the icons of spa.min@20.css (the Total.js icon font); a name that is not there shows nothing
	var have = {};
	Total.Fs.readFileSync(Total.Path.join(__dirname, 'icons.txt'), 'utf8').split('\n').forEach(name => name && (have[name] = 1));
	var missing = [];

	function scan(dir) {
		Total.Fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
			var full = Total.Path.join(dir, entry.name);
			if (entry.isDirectory())
				return scan(full);
			if (!/\.(html|js)$/.test(entry.name))
				return;
			(Total.Fs.readFileSync(full, 'utf8').match(/\bti ti-[a-z0-9-]+|"ti-[a-z0-9-]+|ti-[a-z0-9-]+(?=["' ])/g) || []).forEach(function(match) {
				var name = match.replace(/^.*ti-/, '');
				if (!have[name] && name !== 'icon' && missing.indexOf(name) === -1)
					missing.push(name);
			});
		});
	}

	['plugins', 'views'].forEach(dir => scan(Total.Path.join(__dirname, '..', dir)));
	check('every icon name of the interface exists in the font' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
	next();
});

Test.push('reasoning of Claude and Gemini', async function(next) {

	var mock = require('./mock-openai');
	var root = 'http://127.0.0.1:8111';

	await api('providers_save', { name: 'Claude think', url: root, kind: 'anthropic', key: 'test-key', models: ['claude-test'], meta: { 'claude-test': { id: 'claude-test', reasoning: true, tools: true } } });
	await api('providers_save', { name: 'Gemini think', url: root, kind: 'gemini', key: 'test-key', models: ['gemini-test'], meta: { 'gemini-test': { id: 'gemini-test', reasoning: true, tools: true } } });
	await new Promise(resolve => setTimeout(resolve, 300));

	// Claude: a budget of tokens, and the signed thought comes back with the tool call
	var id = await session({ model: 'claude-think:claude-test', reasoning: 'medium' });
	events.length = 0;
	mock.calls.length = 0;
	await api('sessions_prompt/' + id, { text: 'please read the file' });
	await idle(id);
	var calls = mock.calls.filter(c => c.kind === 'anthropic');
	check('Claude gets a thinking budget and room for the answer after it', calls[0].body.thinking && calls[0].body.thinking.type === 'enabled' && calls[0].body.thinking.budget_tokens === 8192 && calls[0].body.max_tokens > 8192);
	var turn = calls[1].body.messages.find(m => m.role === 'assistant');
	check('the thought and its signature go first in the assistant turn of the tool call', turn.content[0].type === 'thinking' && turn.content[0].signature === 'SIGNED-THOUGHT' && turn.content[0].thinking === 'Claude thinks about it.' && turn.content.some(b => b.type === 'tool_use'));
	var r = await api('sessions_messages/' + id);
	check('the thought is shown as reasoning', r.response.find(m => m.role === 'assistant').parts.some(p => p.type === 'reasoning' && /Claude thinks/.test(p.data.text)));

	// Without a level or with "none" nothing is sent
	events.length = 0;
	mock.calls.length = 0;
	await api('sessions_prompt/' + id, { text: 'plain hello', reasoning: 'none' });
	await idle(id);
	calls = mock.calls.filter(c => c.kind === 'anthropic');
	check('"none" sends no thinking to Claude', !calls[0].body.thinking && calls[0].body.max_tokens === 8192);

	// A model that does not think is never sent the setting
	id = await session({ model: 'claude-mock:claude-test', reasoning: 'high' });
	events.length = 0;
	mock.calls.length = 0;
	await api('sessions_prompt/' + id, { text: 'plain hello' });
	await idle(id);
	check('a model that is not known to think gets no thinking', !mock.calls.filter(c => c.kind === 'anthropic')[0].body.thinking);

	// Gemini 2.5: a budget; the thoughts become reasoning
	id = await session({ model: 'gemini-think:gemini-test', reasoning: 'high' });
	events.length = 0;
	mock.calls.length = 0;
	await api('sessions_prompt/' + id, { text: 'plain hello' });
	await idle(id);
	var g = mock.calls.filter(c => c.kind === 'gemini')[0];
	check('Gemini 2.5 gets a thinking budget and asks for the thoughts', g.body.generationConfig.thinkingConfig.thinkingBudget === 24576 && g.body.generationConfig.thinkingConfig.includeThoughts === true);
	r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the thoughts of Gemini are reasoning, not text', parts.some(p => p.type === 'reasoning' && /Gemini thinks/.test(p.data.text)) && !parts.some(p => p.type === 'text' && /thinks about it/.test(p.data.text)));

	events.length = 0;
	mock.calls.length = 0;
	await api('sessions_prompt/' + id, { text: 'again', reasoning: 'none' });
	await idle(id);
	g = mock.calls.filter(c => c.kind === 'gemini')[0];
	check('"none" switches the thinking of Gemini 2.5 off', g.body.generationConfig.thinkingConfig.thinkingBudget === 0 && g.body.generationConfig.thinkingConfig.includeThoughts === false);
	next();
});

Test.push('Totem as an MCP server', async function(next) {

	var base = 'http://127.0.0.1:' + PORT + '/$mcp/';

	// Off in the config; the test switches it on like an owner would and lets the framework read the config again
	check('the MCP server is off by default', CONF.$mcp === false && !Total.mcp.route);
	CONF.$mcp = true;
	EMIT('configure');
	await new Promise(resolve => setTimeout(resolve, 300));

	function rpc(method, params, headers) {
		return new Promise(function(resolve) {
			var builder = RESTBuilder.POST(base, { jsonrpc: '2.0', id: 1, method: method, params: params || {} }).header('content-type', 'application/json').header('accept', 'application/json, text/event-stream');
			Object.keys(headers || {}).forEach(key => builder.header(key, headers[key]));
			builder.exec((err, response, output) => resolve({ err: err, response: response, status: output && output.status }));
		});
	}

	var r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
	check('the MCP endpoint answers a program of this computer', r.response && r.response.result && r.response.result.serverInfo !== undefined || (r.response && r.response.result));

	r = await rpc('tools/list');
	var names = ((r.response && r.response.result && r.response.result.tools) || []).map(t => t.name);
	check('the sessions and the projects are tools', ['Projects_list', 'Sessions_list', 'Sessions_create', 'Sessions_read', 'Sessions_messages', 'Sessions_prompt', 'Sessions_abort', 'Sessions_diff'].every(n => names.indexOf(n) !== -1));
	check('the tools of the agent (files, commands) are not exposed', !names.some(n => /^Tools_/.test(n)) && names.indexOf('Permissions_reply') === -1 && names.indexOf('Providers_save') === -1 && names.length === 8);

	r = await rpc('tools/call', { name: 'Projects_list', arguments: {} });
	var text = r.response && r.response.result && r.response.result.content && r.response.result.content[0].text;
	check('a tool call returns the data', !!text && text.indexOf(projectid) !== -1);

	r = await rpc('tools/call', { name: 'Sessions_create', arguments: { input: { projectid: projectid, model: 'fake', name: 'From MCP' } } });
	var created = JSON.parse(r.response.result.content[0].text);
	check('a session is created with its name', created.name === 'From MCP' && created.projectid === projectid);

	script = [{ content: 'Answered over MCP.' }];
	events.length = 0;
	r = await rpc('tools/call', { name: 'Sessions_prompt', arguments: { params: { id: created.id }, input: { text: 'hello from another agent', mode: 'plan' } } });
	await idle(created.id);
	var read = await api('sessions_read/' + created.id);
	r = await api('sessions_messages/' + created.id);
	check('a prompt over MCP runs the agent, in the mode that was asked', read.response.mode === 'plan' && r.response.some(m => m.role === 'assistant' && m.parts.some(p => p.type === 'text' && p.data.text === 'Answered over MCP.')));
	await api('sessions_remove/' + created.id);

	// A web page is refused, with or without a token
	r = await rpc('tools/list', {}, { origin: 'https://evil.example' });
	check('a request that comes from a web page is refused', r.status === 403 || r.status === 401 || (r.response && r.response.error && r.response.error.code === -32001));

	CONF.token = 'secret-token';
	r = await rpc('tools/list');
	check('with a token, a call without it is refused', r.status === 401 || (r.response && r.response.error && r.response.error.code === -32001));
	r = await rpc('tools/list', {}, { authorization: 'Bearer wrong' });
	check('and a wrong one', r.status === 401 || (r.response && r.response.error && r.response.error.code === -32001));
	r = await rpc('tools/list', {}, { authorization: 'Bearer secret-token' });
	check('the token as a Bearer token is accepted', !!(r.response && r.response.result && r.response.result.tools));
	CONF.token = '';
	CONF.$mcp = false;
	EMIT('configure');
	next();
});

Test.push('git state of a project', async function(next) {

	var r = await api('projects_git/' + projectid);
	check('a folder that is not a repository says so', r.response && r.response.repository === false && r.response.files.length === 0);

	var repo = Total.Path.join(TMP, 'repo');
	Total.Fs.mkdirSync(repo, { recursive: true });
	var git = args => Total.Child.execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(args), { cwd: repo, stdio: 'pipe' });
	git(['init', '-q', '-b', 'trunk']);
	Total.Fs.writeFileSync(Total.Path.join(repo, 'kept.txt'), 'one\n');
	Total.Fs.writeFileSync(Total.Path.join(repo, 'gone.txt'), 'bye\n');
	git(['add', '.']);
	git(['commit', '-q', '-m', 'first']);
	Total.Fs.writeFileSync(Total.Path.join(repo, 'kept.txt'), 'two\n');
	Total.Fs.unlinkSync(Total.Path.join(repo, 'gone.txt'));
	Total.Fs.writeFileSync(Total.Path.join(repo, 'new file.txt'), 'x\n');
	Total.Fs.writeFileSync(Total.Path.join(repo, 'staged.txt'), 'y\n');
	git(['add', 'staged.txt']);

	var state = await new Promise(resolve => MODS.git.status(repo, resolve));
	var by = {};
	state.files.forEach(f => by[f.path] = f);
	check('the branch and the files are listed', state.repository === true && state.branch === 'trunk' && state.files.length === 4);
	check('each file has its state', by['kept.txt'].status === 'modified' && by['gone.txt'].status === 'deleted' && by['new file.txt'].status === 'untracked' && by['staged.txt'].status === 'added' && by['staged.txt'].staged === true && by['kept.txt'].staged === false);
	next();
});

function keys(text) {
	return Buffer.from(text, 'utf8').toString('base64');
}

Test.push('interactive terminal', async function(next) {

	CONF.terminalshell = '/bin/sh';
	var id = await session();
	events.length = 0;
	var r = await api('sessions_terminal/' + id, {});
	check('without start nothing is opened', r.response.status === 'none' && !MAIN.terminals[id]);
	r = await api('sessions_terminal/' + id, { start: true, columns: 90, rows: 20 });
	check('the terminal opens in a pseudo-terminal', r.response && r.response.status === 'running');

	await api('sessions_terminalinput/' + id, { data: keys('echo total-$((20+22)); pwd\n') });
	await until(() => events.some(e => e.sessionid === id && e.type === 'terminal.output' && /total-42/.test(e.data.text)));
		check('what the user types runs and the output is sent as events', events.some(e => e.type === 'terminal.output' && /total-42/.test(e.data.text)));

	// It is a real terminal: the shell sees a tty and the size that the client sent
	await api('sessions_terminalresize/' + id, { columns: 77, rows: 31 });
	await api('sessions_terminalinput/' + id, { data: keys('test -t 0 && echo tty-yes; stty size\n') });
	await until(() => (MAIN.terminals[id] || {}).output.indexOf('31 77') !== -1);
	check('the shell has a tty', /tty-yes/.test(MAIN.terminals[id].output));
	check('the terminal can be resized', /31 77/.test(MAIN.terminals[id].output));

	// A reload opens it again and gets what it printed
	r = await api('sessions_terminal/' + id, { columns: 77, rows: 31 });
	check('after a reload the same terminal answers with its output', r.response.status === 'running' && /total-42/.test(r.response.output));
	check('the shell runs in the folder of the project', r.response.output.indexOf(PROJECT) !== -1 || r.response.output.indexOf(Total.Fs.realpathSync(PROJECT)) !== -1);

	// The shell does not receive the keys of the providers or the token
	process.env.TOTEM_SECRET_TEST = 'leak';
	await api('sessions_terminalinput/' + id, { data: keys('env | grep -c TOTEM_SECRET; echo done-env\n') });
	await until(() => /done-env/.test(MAIN.terminals[id].output.split('echo done-env').pop()));
	check('the shell does not inherit the environment of the server', /\n0\r?\n/.test(MAIN.terminals[id].output.split('echo done-env').pop()));
	delete process.env.TOTEM_SECRET_TEST;

	// Closing it
	await api('sessions_terminalinput/' + id, { data: keys('exit\n') });
	await until(() => MAIN.terminals[id].status !== 'running');
	check('exit ends the terminal and says so', MAIN.terminals[id].status === 'exited' && events.some(e => e.type === 'terminal.exit'));
	r = await api('sessions_terminalinput/' + id, { data: keys('x') });
	check('typing into a closed terminal is refused', !!r.err);

	// A new one can be opened and Stop ends it
	r = await api('sessions_terminal/' + id, { start: true });
	check('a closed terminal opens again', r.response.status === 'running' && r.response.output === '');
	await api('sessions_terminalstop/' + id);
	check('Stop ends it', MAIN.terminals[id].status === 'stopped');

	// A project whose folder is gone says so instead of a confusing spawn error
	var gone = MODS.terminal.open({ sessionid: 'gone', root: Total.Path.join(TMP, 'no-such-folder') });
	check('a missing project folder is reported', gone.status === 'exited' && /does not exist/.test(gone.output));
	MODS.terminal.clear('gone');

	// Removing the session ends its terminal
	await api('sessions_terminal/' + id, { start: true });
	check('another terminal is running', MODS.terminal.running(id));
	await api('sessions_remove/' + id);
	check('removing the session ends the terminal', !MAIN.terminals[id]);
	CONF.terminalshell = '';
	next();
});

Test.push('listening beyond this computer needs a token', function(next) {
	check('127.0.0.1 and localhost start without a token', !FUNC.listencheck('127.0.0.1', '') && !FUNC.listencheck('localhost', '') && !FUNC.listencheck('::1', '') && !FUNC.listencheck('', ''));
	check('0.0.0.0 without a token is refused', /no access token/.test(FUNC.listencheck('0.0.0.0', '')));
	check('another address without a token is refused', /no access token/.test(FUNC.listencheck('192.168.1.5', '')));
	check('0.0.0.0 with a token starts', FUNC.listencheck('0.0.0.0', 'abc') === '');

	var tokenfile = Total.Path.join(TMP, 'token.txt');
	Total.Fs.writeFileSync(tokenfile, 'from-a-file\n');
	CONF.tokenfile = tokenfile;
	check('the token can come from a file', FUNC.readtoken() === 'from-a-file');
	CONF.token = '';
	CONF.tokenfile = '';
	next();
});

Test.push('scheduled prompts', async function(next) {

	// When a schedule is due
	var now = new Date(2026, 10, 7, 12, 0, 0);
	var minutes = n => new Date(now.getTime() - n * 60000).toISOString();
	var item = { enabled: true, kind: 'interval', interval: 30, dtcreated: minutes(100) };
	check('an interval schedule that never ran is due after its interval', MODS.schedules.due(item, now));
	item.dtlast = minutes(10);
	check('it is not due before the interval passes', !MODS.schedules.due(item, now));
	item.dtlast = minutes(31);
	check('it is due after it', MODS.schedules.due(item, now));
	check('a disabled schedule is never due', !MODS.schedules.due(Object.assign({}, item, { enabled: false }), now));
	check('the interval has a floor of 5 minutes', !MODS.schedules.due({ enabled: true, kind: 'interval', interval: 1, dtlast: minutes(3), dtcreated: minutes(9) }, now) && MODS.schedules.due({ enabled: true, kind: 'interval', interval: 1, dtlast: minutes(6), dtcreated: minutes(9) }, now));
	var daily = { enabled: true, kind: 'daily', time: '07:30', dtcreated: minutes(60 * 30), dtlast: minutes(60 * 30) };
	check('a daily schedule is due after its time', MODS.schedules.due(daily, now));
	daily.dtlast = new Date(2026, 10, 7, 7, 31).toISOString();
	check('and not again the same day', !MODS.schedules.due(daily, now));
	daily.time = '18:00';
	check('a time later today has not come yet', !MODS.schedules.due(Object.assign({}, daily, { dtlast: new Date(2026, 10, 6, 18, 1).toISOString() }), now));
	check('the next run of a daily schedule is a future time', MODS.schedules.next(daily, now).getTime() > now.getTime());

	// Saving
	var base = { projectid: projectid, name: 'Morning review', text: 'Review the project and list what is wrong.', model: 'fake', kind: 'interval', interval: 60 };
	var r = await api('schedules_save', Object.assign({}, base, { interval: 2 }));
	check('an interval under 5 minutes is refused', !!r.err);
	r = await api('schedules_save', Object.assign({}, base, { kind: 'daily', time: '25:99' }));
	check('a wrong time is refused', !!r.err);
	r = await api('schedules_save', Object.assign({}, base, { model: 'nothing:here' }));
	check('an unknown model is refused', !!r.err);
	r = await api('schedules_save', base);
	var schedule = r.response;
	check('a schedule is saved enabled, in plan mode, with its next run', schedule && schedule.id && schedule.enabled === true && schedule.mode === 'plan' && !!schedule.next);
	r = await api('schedules_save', Object.assign({}, base, { id: schedule.id, name: 'Renamed', interval: 90, enabled: false }));
	check('a schedule can be changed and switched off', r.response.name === 'Renamed' && r.response.interval === 90 && r.response.enabled === false && r.response.next === null);
	r = await api('schedules?projectid=' + projectid);
	r = await api('schedules', {});
	check('the schedules are listed', r.response.some(x => x.id === schedule.id));

	// Running one: a new unattended session in Plan mode that cannot change anything
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'sw', name: 'write', arguments: { path: 'sched-plan.txt', content: 'x' } }] },
		{ content: 'Report.' }
	];
	r = await api('schedules_run/' + schedule.id);
	var sid = r.response.sessionid;
	check('running a schedule creates a session', !!sid);
	await idle(sid);
	var created = await NOSQL('sessions').read().where('id', sid).promise();
	check('the session is unattended, in plan mode, named after the schedule and linked to it', created.unattended === true && created.mode === 'plan' && /^Renamed - /.test(created.name) && created.scheduleid === schedule.id);
	check('the prompt of the schedule was sent', requests[0].messages.some(m => m.role === 'user' && /Review the project/.test(m.content)));
	check('plan mode refused the write', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'sched-plan.txt')));
	await until(() => MAIN.scheduled[schedule.id] === undefined);
	var after = await NOSQL('schedules').read().where('id', schedule.id).promise();
	check('the schedule keeps how the last run ended', after.laststatus === 'done' && after.lastsession === sid && !!after.dtlast);

	// Build mode: nobody can approve, so only what is allowed already runs
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'b1', name: 'write', arguments: { path: 'sched-build.txt', content: 'x' } }] },
		{ tools: [{ id: 'b2', name: 'ask', arguments: { question: 'Which one?' } }] },
		{ content: 'Done.' }
	];
	r = await api('schedules_save', Object.assign({}, base, { id: schedule.id, mode: 'build', autoaccept: false, enabled: true }));
	r = await api('schedules_run/' + schedule.id);
	await idle(r.response.sessionid);
	check('in build mode without auto-accept the edit is refused, not asked', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'sched-build.txt')) && requests[1].messages.some(m => m.role === 'tool' && /unattended/.test(m.content)));
	check('no question waits for a person', !events.some(e => e.type === 'permission.ask' || e.type === 'question.ask'));
	check('the question of the model is answered with nobody-is-here', requests[2].messages.some(m => m.role === 'tool' && /Nobody is here/.test(m.content)));

	await until(() => MAIN.scheduled[schedule.id] === undefined);
	events.length = 0;
	script = [{ tools: [{ id: 'b3', name: 'write', arguments: { path: 'sched-build.txt', content: 'built' } }] }, { content: 'Done.' }];
	r = await api('schedules_save', Object.assign({}, base, { id: schedule.id, mode: 'build', autoaccept: true, enabled: true }));
	r = await api('schedules_run/' + schedule.id);
	await idle(r.response.sessionid);
	check('with auto-accept the edit runs', Total.Fs.existsSync(Total.Path.join(PROJECT, 'sched-build.txt')));

	// Never two runs of the same schedule at the same time
	MAIN.scheduled[schedule.id] = true;
	r = await api('schedules_run/' + schedule.id);
	check('a schedule that is running does not start again', !!r.err);
	delete MAIN.scheduled[schedule.id];

	// The tick starts what is due and only once
	events.length = 0;
	script = [{ content: 'Tick.' }];
	await NOSQL('schedules').modify({ kind: 'interval', interval: 10, mode: 'plan', autoaccept: false, dtlast: new Date(Date.now() - 3600000).toISOString() }).where('id', schedule.id).promise();
	var before = (await NOSQL('sessions').find().where('scheduleid', schedule.id).promise()).length;
	await MODS.schedules.tick(new Date());
	await until(() => MAIN.scheduled[schedule.id] === undefined);
	var count = (await NOSQL('sessions').find().where('scheduleid', schedule.id).promise()).length;
	check('the tick starts a due schedule', count === before + 1);
	await MODS.schedules.tick(new Date());
	check('and not again right away', (await NOSQL('sessions').find().where('scheduleid', schedule.id).promise()).length === count);

	// A schedule of a project that is gone says so
	await NOSQL('schedules').modify({ model: 'nothing:here' }).where('id', schedule.id).promise();
	r = await api('schedules_run/' + schedule.id);
	check('a model that is not available is reported', !!r.err);
	after = await NOSQL('schedules').read().where('id', schedule.id).promise();
	check('and stays in the schedule', after.laststatus === 'error' && /model/.test(after.lasterror));

	r = await api('schedules_remove/' + schedule.id);
	check('a schedule can be removed', r.response.success === true);
	next();
});

Test.push('the tools keep the whitespace of what the model writes', async function(next) {

	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [
		{ tools: [{ id: 'ws1', name: 'write', arguments: { path: 'ws.txt', content: '\tfirst\n  second\n\n' } }] },
		{ tools: [{ id: 'ws2', name: 'edit', arguments: { path: 'ws.txt', oldstring: '\tfirst', newstring: '\t\tindented' } }] },
		{ content: 'ok' }
	];
	await api('sessions_prompt/' + id, { text: 'whitespace' });
	await idle(id);
	check('a file keeps its indentation and its final newlines', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'ws.txt'), 'utf8') === '\t\tindented\n  second\n\n');
	next();
});

Test.push('a shared server: token, cookie, origins and headers', async function(next) {

	// The token is compared without leaking where it differs
	check('the right token is accepted', FUNC.sametoken('secret-token', 'secret-token'));
	check('a wrong, a short, a long and an empty token are not', !FUNC.sametoken('secret-tokex', 'secret-token') && !FUNC.sametoken('secret', 'secret-token') && !FUNC.sametoken('secret-token-and-more', 'secret-token') && !FUNC.sametoken('', 'secret-token') && !FUNC.sametoken(undefined, 'secret-token') && !FUNC.sametoken('x', ''));

	check('a request without Origin is ours', FUNC.sameorigin({ host: 'totem.local:8000' }));
	check('an Origin with the host that was asked is ours', FUNC.sameorigin({ origin: 'http://totem.local:8000', host: 'totem.local:8000' }));
	check('a reverse proxy can forward the host', FUNC.sameorigin({ origin: 'https://totem.example.com', host: 'internal:8000', 'x-forwarded-host': 'totem.example.com' }));
	check('another origin is not', !FUNC.sameorigin({ origin: 'https://evil.example', host: 'totem.local:8000' }) && !FUNC.sameorigin({ origin: 'null', host: 'totem.local:8000' }));

	function post(headers, data) {
		return new Promise(function(resolve) {
			var builder = RESTBuilder.POST(URL, data || { schema: 'projects' });
			Object.keys(headers).forEach(key => builder.header(key, headers[key]));
			builder.exec((err, response, output) => resolve({ err: err, response: response, output: output }));
		});
	}

	// Headers of every response
	var r = await new Promise(resolve => RESTBuilder.GET('http://127.0.0.1:' + PORT + '/').exec((err, response, output) => resolve(output)));
	var h = r.headers || {};
	check('responses forbid sniffing, framing and referrers', h['x-content-type-options'] === 'nosniff' && h['x-frame-options'] === 'DENY' && h['referrer-policy'] === 'no-referrer' && /frame-ancestors 'none'/.test(h['content-security-policy'] || ''));

	// A request that changes something from a page of another origin is refused, a call without Origin or from our own page is not
	r = await post({ origin: 'https://evil.example' });
	check('a POST from another origin is refused', r.output.status === 403);
	r = await post({ origin: 'http://127.0.0.1:' + PORT });
	check('a POST from our own page goes through', r.output.status === 200);
	r = await post({});
	check('a POST without Origin (a program) goes through', r.output.status === 200);

	// The cookie of the login cannot be read by a script nor sent by another site
	CONF.token = 'login-token';
	r = await post({}, { schema: 'login', data: { token: 'login-token' } });
	var cookie = [].concat((r.output.headers || {})['set-cookie'] || []).join(' ');
	check('the login sets the cookie as HttpOnly and SameSite=Strict', /totem=login-token/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie));
	r = await post({}, { schema: 'login', data: { token: 'login-toke' } });
	check('a wrong token does not sign in', !!r.response && JSON.stringify(r.response).indexOf('Invalid token') !== -1 || r.output.status >= 400);
	CONF.token = '';

	// The WebSocket: a page of another origin is closed, our own page and a program stay
	// Raw upgrade requests: the WebSocket client of Node.js does not let a script choose Origin, a browser always sends it
	function open(headers) {
		return new Promise(function(resolve) {
			var done = false;
			var opened = false;
			var socket = null;
			function finish(closed) {
				if (done)
					return;
				done = true;
				resolve({ closed: closed, opened: opened, ws: { close: () => socket && socket.destroy() } });
			}
			var request = require('node:http').request({ host: '127.0.0.1', port: PORT, path: '/api/', headers: Object.assign({ Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64') }, headers) });
			request.on('upgrade', function(res, sock) {
				opened = true;
				socket = sock;
				sock.on('close', () => finish(true));
				sock.on('end', () => finish(true));
				sock.on('error', () => finish(true));
			});
			request.on('response', () => finish(true));
			request.on('error', () => finish(true));
			request.end();
			setTimeout(() => finish(false), 800);
		});
	}

	var foreign = await open({ origin: 'https://evil.example' });
	check('a WebSocket from another origin is closed', foreign.closed === true);
	var own = await open({ origin: 'http://127.0.0.1:' + PORT });
	check('a WebSocket from our own page stays open', own.closed === false && own.opened === true);
	own.ws && own.ws.close();
	var program = await open({});
	check('a WebSocket from a program stays open', program.closed === false && program.opened === true);
	program.ws && program.ws.close();
	next();
});

Test.push('recipes of Totem', function(next) {

	var ids = text => MODS.knowledge.recipes(text).map(r => r.id);

	check('a route question gets the recipe of routes', ids('How do I define a route in Total.js 5 that answers GET /hello with the text Hello?').indexOf('route') === 0);
	check('a NoSQL question gets the recipe of NoSQL', ids('Insert a record in NoSQL and read it back with Total.js 5.')[0] === 'nosql');
	check('a WebSocket question gets the recipe of WebSockets', ids('Create a WebSocket route in Total.js 5 that sends every message to all clients.').indexOf('websocket') !== -1);
	check('a question about settings gets the recipe of the config', ids('Where does a Total.js 5 application keep its settings and how do I read one?')[0] === 'config');
	check('a question about schedules gets the recipe of CRON', ids('Run a function every day at midnight in Total.js 5.')[0] === 'cron');
	check('a question about outgoing requests gets RESTBuilder', ids('Make an outgoing HTTP GET request that returns JSON in Total.js 5.')[0] === 'restbuilder');
	check('a question in Spanish finds the recipe too', ids('como creo una ruta que devuelva json en total.js').indexOf('route') !== -1);
	check('a plugin question gets the recipe of plugins and a route question does not', ids('Write a plugin html file with a button that calls the server').indexOf('plugin') !== -1 && ids('Show me a controller with two routes').indexOf('plugin') === -1 && ids('Show me a controller with two routes').indexOf('component') === -1);
	check('a greeting and a word of the topic alone get nothing', ids('hello how are you').length === 0 && ids('please write the text').length === 0);
	check('a question about ids and dates gets UID and NOW, one about modules gets MODS', ids('How do I create an id and a creation date for a new record in Total.js 5?')[0] === 'uid-now' && ids('Show how to call a function of one of my modules from a Total.js 5 action.').indexOf('mods') !== -1);
	check('the pages of Forge are written with the pipe of the conventions', MODS.knowledge.conventions("NEWACTION('Products/query', {\n}); ROUTE('+API ? -products --> Products/query'); NEWACTION('Reports/Categories/list', {}); var url = 'a/b';") === "NEWACTION('Products|query', {\n}); ROUTE('+API ? -products --> Products|query'); NEWACTION('Reports|Categories|list', {}); var url = 'a/b';");
	check('a stem catches the Spanish in any form', ids('ahora como la protejo para que solo entren usuarios autenticados?')[0] === 'auth' && MODS.knowledge.route('como valido los usuarios autenticados').query.indexOf('authentication') !== -1);
	check('at most two recipes by default and the best first', ids('route action nosql config cron websocket auth').length === 2 && MODS.knowledge.recipes('route action nosql', 1).length === 1);
	check('every recipe has a title, keywords and a body with code', MODS.knowledge.recipes('route routes ruta controller action newaction nosql config cron websocket auth view plugin jcomponent restbuilder translate es5 func mods callback fs uid memory empiezo html complete tarjeta toggle', 99).length === 22 && MODS.knowledge.recipes('nosql', 1)[0].body.indexOf('```js') !== -1);

	var all = MODS.knowledge.recipes('route routes ruta controller action newaction nosql config cron websocket auth view plugin jcomponent restbuilder translate es5 func mods callback fs uid memory empiezo html complete tarjeta toggle', 99);
	var codes = all.map(r => (r.body.match(/```js\n[\s\S]*?```/g) || []).map(b => b.replace(/```js\n|```/g, ''))).reduce((list, items) => list.concat(items), []);
	check('the code of the recipes follows the conventions it teaches: tabs, no let or const, no arrow functions', codes.length > 10 && codes.every(code => !/^ {2,}\S/m.test(code) && !/^\s*(let|const)\s/m.test(code) && !/=>/.test(code) && !/`/.test(code)));

	// A small model copies what it sees: the history without old code, no recipe twice in a row, nothing to look up for a command
	var old = MODS.agent.lighthistory([
		{ role: 'user', content: 'make an action' },
		{ role: 'assistant', content: 'Here:\n```js\nNEWACTION(1)\n```\nDone' },
		{ role: 'user', content: 'hola' },
		{ role: 'assistant', content: 'Now:\n```js\nNEWACTION(2)\n```' }
	]);
	check('old answers lose their code and the last turn keeps it', old[1].content === 'Here:\n(code omitted)\nDone' && old[3].content.indexOf('NEWACTION(2)') !== -1 && old[0].content === 'make an action' && old[2].content === 'hola');

	var fake = (extra) => Object.assign({ root: ROOT, mcp: null, shown: [], command: false }, extra || {});
	var run1 = fake();
	MODS.knowledge.prefetch(run1, 'Create an API route and its action that lists tickets in Total.js 5.', function(pages1) {
		var run2 = fake({ shown: run1.recipeids });
		MODS.knowledge.prefetch(run2, 'Create an API route and its action that lists tickets in Total.js 5.', function(pages2) {
			var run3 = fake({ command: true });
			MODS.knowledge.prefetch(run3, 'Study this project and write AGENTS.md in its root. Read package.json and config.', function(pages3) {
				check('the recipes remain available for follow-ups, and a command looks nothing up', run1.recipeids.length > 0 && run2.recipeids.length > 0 && !!run2.knowledge && pages3.length === 0 && !run3.knowledge);
				next();
			});
		});
	});
});

Test.push('developer answer presentation and permission regressions', async function(next) {
	var raw = '<!DOCTYPE html>\n<html><head><title>Demo</title></head><body><p>Hello</p></body></html>';
	check('a raw complete HTML document is fenced without losing its tags', MODS.conventions.prepare(raw) === '```html\n' + raw + '\n```');
	check('a correction that echoes its private review keeps only the code', MODS.conventions.prepare('Totem checked the code of your answer against conventions.\nReturn only the final solution.\n```js\nvar x = 1;\n```', true) === '```js\nvar x = 1;\n```');
	check('already fenced code is unchanged', MODS.conventions.prepare('```html\n' + raw + '\n```') === '```html\n' + raw + '\n```');
	check('invented frontend APIs are rejected', MODS.conventions.answer('```html\n<script>new TOTAL.Component("card");</script>\n```').some(p => p.rule === 'jcomponent-api'));
	check('syntax inside HTML scripts is checked', MODS.conventions.answer('```html\n<script>var value = (;</script>\n```').some(p => p.rule === 'syntax'));
	check('translated HTML strings do not hide syntax errors', MODS.conventions.answer('```html\n<script>var COMPONENT("x", function(self) { self.html("<b>@(Hello)</b>"); });</script>\n```').some(p => p.rule === 'syntax'));
	var ranked = MODS.knowledge.rank([
		{ section: 'Total.js 5', title: 'Test a Flow component with config', url: 'https://example.test/flowstream-config.md', description: 'config settings application' },
		{ section: 'Total.js 5', title: 'Application settings and CONF', url: 'https://example.test/config.md', description: 'config settings application' }
	], { query: 'config settings', product: 'total5', recipe: 'config' }, 2);
	check('application settings cannot be displaced by a Flow configuration example', ranked.length === 1 && /config.md$/.test(ranked[0].url));
	check('a template marker in a string cannot disable syntax checking', MODS.conventions.answer('```js\nvar template = "@{model.name}"; var broken = (;\n```').some(p => p.rule === 'syntax'));
	check('complete HTML requests select the page recipe first', MODS.knowledge.recipes('dame un html completo con el componente que lo muestre')[0].id === 'html-page');
	check('asking for an id in an application is not a request to scaffold one', !MODS.knowledge.apprequest('Create an id for my application') && !MODS.knowledge.apprequest('How do I create an application?'));
	check('a clear application request prioritizes the complete starter over individual files', MODS.knowledge.recipes('Crea una aplicación mínima Total.js con config y controllers/default.js')[0].id === 'new-app');
	check('a message visibility request has a recipe that preserves the bound message', MODS.knowledge.recipes('un componente tarjeta con mensaje y boton para mostrar u ocultar')[0].id === 'toggle-card');
	check('HTML with a component selects browser documentation', MODS.knowledge.route('dame un html completo con el componente que lo muestre').product === 'jcomponent');

	var run = { root: PROJECT, projectid: projectid, sessionid: sessionid, mode: 'plan', unattended: true };
	function allowed(tool, input) {
		return new Promise(resolve => MODS.permissions.check(run, tool, input, reply => resolve(reply)));
	}
	check('Plan refuses destructive find options', await allowed('bash', { command: 'find . -name a.txt -delete' }) === 'deny');
	check('Plan refuses an MCP call even with a global allow', await allowed('mcp:write', { content: 'x' }) === 'deny');
	run.mode = 'build';
	check('an unattended Build cannot run destructive find without approval', await allowed('bash', { command: 'find . -name a.txt -delete' }) === 'deny');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.env'), 'TOTEM_PRIVATE_VALUE=unknown-secret-value\n');
	var result = await ACTION('Tools|grep', { path: '.', pattern: 'TOTEM_PRIVATE_VALUE' }).user({ root: PROJECT }).promise();
	check('searching a folder never discloses env files', result === '(no matches)');
	result = await ACTION('Tools|grep', { path: '.env', pattern: 'TOTEM_PRIVATE_VALUE' }).user({ root: PROJECT }).promise();
	check('searching an env file directly does not bypass read approval', result === '(no matches)');
	next();
});

Test.push('files from the answer of a small model', function(next) {

	var root = Total.Path.join(TMP, 'newfiles');
	Total.Fs.mkdirSync(root, { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(root, 'old.js'), 'x');
	var run = { root: root, asked: 'crea el package.json y el archivo schemas/a.js' };
	var files = MODS.agent.newfiles(run, [
		'Step 1: `package.json`', '```json', '{ "name": "x" }', '```',
		'```js', '// schemas/a.js', 'var a = 1;', '```',
		'```js', '// old.js', 'var b = 1;', '```',
		'```bash', 'echo hi > run.sh', '```',
		'```js', '// ../outside.js', 'x', '```',
		'**readme.txt**', '```', 'not asked by the user', '```'
	].join('\n'));

	check('the blocks with a path, or named by the line before and by the user, become files', files.length === 2 && files[0].path === 'package.json' && files[1].path === 'schemas/a.js' && files[1].content === '// schemas/a.js\nvar a = 1;\n');
	check('a file that exists, a shell block, a path outside and a name that the user did not say are left alone', !files.some(f => /old\.js|run\.sh|outside|readme/.test(f.path)));
	next();
});

Test.push('a small model creates all named files and gets their diagnostics', async function(next) {
	NEWAIMODEL('scripted:1.5b', fake);
	var id = await session({ model: 'scripted:1.5b', autoaccept: true });
	var text = [];
	for (var i = 1; i <= 6; i++)
		text.push('`generated/file' + i + '.js`\n```js\nvar value = ' + i + ';\n```');
	events.length = 0;
	requests.length = 0;
	script = [{ content: text.join('\n\n') }, { content: 'The files were created.' }];
	await api('sessions_prompt/' + id, { text: 'create the files for the application' });
	await idle(id);
	check('a generated application is not silently limited to four files', [1, 2, 3, 4, 5, 6].every(n => Total.Fs.existsSync(Total.Path.join(PROJECT, 'generated/file' + n + '.js'))));
	check('write results return to the model before it finishes', requests.length === 2 && requests[1].messages.filter(m => m.role === 'tool' && /^Written/.test(m.content)).length === 6);
	next();
});

Test.push('a small model starts a new application through approved native files', async function(next) {
	NEWAIMODEL('scripted:1.5b', fake);
	var folder = Total.Path.join(TMP, 'starter-app');
	Total.Fs.mkdirSync(folder);
	var project = (await api('projects_open', { path: folder })).response;
	var id = (await api('sessions_create', { projectid: project.id, model: 'scripted:1.5b' })).response.id;
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Created the starter.' }];
	var handled = {};
	var approver = setInterval(function() {
		events.filter(e => e.type === 'permission.ask' && e.sessionid === id).forEach(function(e) {
			if (!handled[e.data.id]) {
				handled[e.data.id] = e.data.tool;
				api('permissions_reply/' + e.data.id, { reply: e.data.tool === 'write' ? 'once' : 'reject' });
			}
		});
	}, 20);
	await api('sessions_prompt/' + id, { text: 'Crea una aplicación mínima Total.js 5 con GET /hello y el texto Hello en controllers/default.js' });
	await idle(id);
	clearInterval(approver);
	check('the four starter writes ask before running', Object.keys(handled).filter(id => handled[id] === 'write').length === 4);
	check('the created starter uses the real framework boot sequence', /F\.run/.test(Total.Fs.readFileSync(Total.Path.join(folder, 'index.js'), 'utf8')) && !!JSON.parse(Total.Fs.readFileSync(Total.Path.join(folder, 'package.json'), 'utf8')).dependencies.total5);
	check('the requested route is already in its controller', /GET \/hello/.test(Total.Fs.readFileSync(Total.Path.join(folder, 'controllers/default.js'), 'utf8')));
	check('the model continues from successful writes instead of inventing the bootstrap', requests.length === 1 && requests[0].messages.filter(m => m.role === 'tool' && /^Written/.test(m.content)).length === 4);
	await api('projects_remove/' + project.id);
	next();
});

Test.push('the write tool leaves out a first line that only names the file', async function(next) {

	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [
		{ tools: [
			{ id: 'n1', name: 'write', arguments: { path: 'named/index.js', content: '# index.js\nvar a = 1;\n' } },
			{ id: 'n2', name: 'write', arguments: { path: 'named/ok.js', content: '// ok.js\nvar b = 1;\n' } },
			{ id: 'n3', name: 'write', arguments: { path: 'named/package.json', content: '// package.json\n{ "name": "x" }\n' } },
			{ id: 'n4', name: 'write', arguments: { path: 'named/run.sh', content: '# run.sh\necho hi\n' } }
		] },
		{ content: 'Done.' }
	];
	await api('sessions_prompt/' + id, { text: 'write them' });
	await idle(id);
	var read = name => Total.Fs.readFileSync(Total.Path.join(PROJECT, 'named', name), 'utf8');
	check('a # name in a .js file and a // name in a .json file are left out', read('index.js') === 'var a = 1;\n' && read('package.json') === '{ "name": "x" }\n');
	check('a comment that the language allows stays, and so does one in a shell script', read('ok.js') === '// ok.js\nvar b = 1;\n' && read('run.sh') === '# run.sh\necho hi\n');
	next();
});

Test.push('/new makes the files of an application and /init makes AGENTS.md for a small model', async function(next) {

	var dir = Total.Path.join(TMP, 'scaffold');
	Total.Fs.mkdirSync(dir, { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(dir, 'index.js'), 'mine');
	var plan = MODS.commands.scaffold(dir, 'My Tasks');
	check('the scaffold has the files of an application and leaves the ones that exist', plan.files.some(f => f.path === 'package.json') && !plan.files.some(f => f.path === 'index.js') && plan.skipped.join() === 'index.js');
	var pkg = JSON.parse(plan.files.find(f => f.path === 'package.json').content);
	check('its package.json depends on total5 and the name is a slug', !!pkg.dependencies.total5 && pkg.name === 'my-tasks' && pkg.scripts.start === 'node index.js');
	var requested = MODS.commands.scaffold(dir, 'hello', 'Crea una aplicación mínima con GET /hello y el texto Hello en controllers/default.js');
	var first = requested.files.find(f => f.path === 'controllers/default.js');
	check('the scaffold can use an explicitly requested first route and literal reply', first && /GET \/hello/.test(first.content) && /Hello/.test(first.content));
	check('its first route answers', /ROUTE\('GET \/'/.test(plan.files.find(f => f.path === 'controllers/index.js').content));

	Total.Fs.mkdirSync(Total.Path.join(dir, 'controllers'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', description: 'A demo', scripts: { test: 'node t.js' }, dependencies: { total5: '1' } }));
	var agents = MODS.commands.agents(dir);
	check('AGENTS.md is made from the files: folders, scripts and the conventions of Total.js', /^# demo/.test(agents) && /A demo/.test(agents) && /`controllers\/`: routes/.test(agents) && /npm run test/.test(agents) && /Total\.js 5: ES5/.test(agents) && !/## Run\n\n\n/.test(agents));
	Total.Fs.writeFileSync(Total.Path.join(dir, 'AGENTS.md'), 'x');
	check('and an AGENTS.md that exists is not replaced', MODS.commands.agents(dir) === '');

	// In a session: /new writes the files with the write tool
	var id = await session({ autoaccept: true });
	events.length = 0;
	await api('sessions_prompt/' + id, { text: '/new fresh app' });
	await idle(id);
	check('/new writes the files in the project of the session', Total.Fs.existsSync(Total.Path.join(PROJECT, 'controllers/index.js')) && /fresh-app/.test(Total.Fs.readFileSync(Total.Path.join(PROJECT, 'config'), 'utf8')) && events.some(e => e.type === 'part.created' && e.data.part.type === 'tool' || e.type === 'part.updated'));
	next();
});

Test.push('save a code block of an answer', async function(next) {

	var id = await session();
	events.length = 0;
	script = [{ content: '```js\n// schemas/saved.js\nvar x = 1;\n```' }];
	await api('sessions_prompt/' + id, { text: 'make it' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	var file = Total.Path.join(PROJECT, 'schemas/saved.js');

	r = await api('sessions_saveblock/' + id, { messageid: assistant.id, path: 'schemas/saved.js', content: 'var x = 1;\n' });
	check('a block is saved as the file of its path', r.response && r.response.path === 'schemas/saved.js' && Total.Fs.readFileSync(file, 'utf8') === 'var x = 1;\n');

	r = await api('sessions_saveblock/' + id, { messageid: assistant.id, path: 'schemas/saved.js', content: 'var x = 2;\n' });
	check('a file that exists is not replaced unless the user says so', r.response && r.response.exists === true && Total.Fs.readFileSync(file, 'utf8') === 'var x = 1;\n');

	r = await api('sessions_saveblock/' + id, { messageid: assistant.id, path: 'schemas/saved.js', content: 'var x = 2;\n', replace: true });
	check('and is replaced when the user does', Total.Fs.readFileSync(file, 'utf8') === 'var x = 2;\n');

	var refused = 0;
	for (var path of ['../outside.js', '/etc/passwd', '.git/config', '.env', 'a/.env.local']) {
		r = await api('sessions_saveblock/' + id, { messageid: assistant.id, path: path, content: 'x' });
		if (!r.response || !r.response.path)
			refused++;
	}
	check('a path outside the project, in .git or a secrets file is refused', refused === 5 && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'a/.env.local')));

	r = await api('sessions_undo/' + id, { messageid: assistant.id });
	check('the save is in the undo of the message', !Total.Fs.existsSync(file));
	next();
});

Test.push('Forge without MCP: llms.txt and the pages in Markdown', function(next) {

	var Http = require('http');
	var hits = [];
	var index = [
		'# Forge', '', '## Start here', '', '- [Why choose Total.js](http://127.0.0.1:{port}/en/docs/why.md): Reasons', '',
		'## Total.js 5 (backend)', '',
		'- [Validate a JSON body with an action](http://127.0.0.1:{port}/en/total5/validate-json-body.md): Define an input schema on an action.',
		'- [Read URL parameters in a route](http://127.0.0.1:{port}/en/total5/routes-with-params.md): Declare segments such as {id}.',
		'', '## jComponent 20 (frontend)', '',
		'- [A counter component](http://127.0.0.1:{port}/en/jcomponent/counter.md): COMPONENT with a button.'
	].join('\n');

	var server = Http.createServer(function(req, res) {
		hits.push(req.url);
		res.setHeader('content-type', 'text/plain; charset=utf-8');
		if (req.url === '/llms.txt')
			res.end(index.split('{port}').join(server.address().port));
		else if (req.url === '/en/total5/validate-json-body.md')
			res.end('# Validate a JSON body with an action\n\nSource: x\nFramework: total5@0.0.19\nContent-SHA256: abc\nSnapshot: def\nSources: s\nReview: not-recorded\n\nUse `input` with NEWACTION(\'Users/create\', {}).\n');
		else {
			res.statusCode = 404;
			res.end('no');
		}
	});

	server.listen(0, '127.0.0.1', function() {

		var base = 'http://127.0.0.1:' + server.address().port;
		var items = MODS.knowledge.parseindex(index.split('{port}').join(server.address().port));
		check('the index is read: title, address in Markdown, description and the section', items.length === 4 && items[1].section === 'Total.js 5 (backend)' && /validate-json-body\.md$/.test(items[1].url) && /input schema/.test(items[1].description));

		// knowledge.json: the API names of a document find it even when the prompt shares nothing else with its title
		var withmeta = [
			{ section: 'Total.js 5 (backend)', title: 'Run code on a schedule', url: 'https://example.test/en/total5/cron-jobs.md', description: 'Register a function and a line.' },
			{ section: 'Total.js 5 (backend)', title: 'Other page', url: 'https://example.test/en/total5/other.md', description: 'Nothing here.' }
		];
		MODS.knowledge.addmeta(withmeta, JSON.stringify({ documents: [{ section: 'total5', slug: 'cron-jobs', symbols: ['CRON', 'GET'], tags: ['scheduler'] }, { section: 'total5', slug: 'other', symbols: ['GET'], tags: [] }] }));
		check('the metadata of Forge is joined to the pages by section and slug', withmeta[0].symbols[0] === 'cron' && withmeta[0].tags[0] === 'scheduler');
		check('the API name and the tag in the prompt find a page whose title says neither', MODS.knowledge.rank(withmeta, { query: 'cron scheduler hourly', product: 'total5' }, 2).map(i => i.url).join() === 'https://example.test/en/total5/cron-jobs.md');
		MODS.knowledge.addmeta(withmeta, 'not json');
		check('a metadata file that is not valid changes nothing', withmeta[0].symbols[0] === 'cron');

		check('Spanish verbs of the request are translated for the search of the pages', MODS.knowledge.route('Cómo envío un correo en Total.js').query.indexOf('send email') !== -1 && MODS.knowledge.route('como sirvo archivos estáticos').query.indexOf('serve file static') !== -1);
		check('a request about Tangular is not sent only to the frontend', MODS.knowledge.route('How do I use Tangular templates in a view?').product !== 'jcomponent');

		var rows = []; for (var n = 0; n < 60; n++) rows.push('| key' + n + ' | default | what key' + n + ' does in the application |');
		var page = '# Keys\n\n> Settings.\n\nIntro paragraph of the page.\n\n## Table\n\n' + rows.join('\n') + '\n\n## Mail\n\n```js\nCONF.mail_smtp = "localhost";\n```\n\nSet the smtp server.';
		var fitted = MODS.knowledge.fit(page, 'key42 smtp', 1500);
		check('a long page keeps its start, the rows and the code the request asks for, never more than the limit', fitted.length <= 1500 && /^# Keys/.test(fitted) && /key42/.test(fitted) && /CONF\.mail_smtp/.test(fitted) && /\[\.\.\.\]/.test(fitted));
		check('a block of code is never cut in half', (fitted.match(/```/g) || []).length % 2 === 0 && MODS.knowledge.fit('# T\n\nText.\n\n```js\n' + 'var a = 1;\n'.repeat(200) + '```\n', 'a', 800).indexOf('```') === -1);
		check('a short page is not changed', MODS.knowledge.fit('# T\n\nShort.', 'x', 3500) === '# T\n\nShort.');

		var ranked = MODS.knowledge.rank(items, MODS.knowledge.route('How do I validate a JSON body of an action in Total.js 5?'), 2);
		check('the words of the prompt rank the pages of the product, never the sections that are not documentation', ranked.length >= 1 && /validate-json-body/.test(ranked[0].url) && !ranked.some(r => r.section === 'Start here'));
		check('a prompt about the interface looks in jComponent', MODS.knowledge.rank(items, MODS.knowledge.route('write a jcomponent counter component'), 2)[0].title === 'A counter component');

		CONF.forgedocs = true;
		CONF.forgeurl = base;
		MAIN.forgeindex = null;

		var run = { root: ROOT, mcp: null, shown: [], command: false };

		MODS.knowledge.prefetch(run, 'How do I validate a JSON body of an action in Total.js 5?', function(pages) {

			check('the page of Forge goes into the prompt without the header and with the pipe in action names', pages.some(p => /Validate a JSON body/.test(p.title)) && /Use `input` with NEWACTION\('Users\|create'/.test(run.knowledge) && !/Content-SHA256|Snapshot:/.test(run.knowledge));

			var before = hits.filter(h => h === '/llms.txt').length;
			MODS.knowledge.prefetch({ root: ROOT, mcp: null, shown: [], command: false }, 'How do I read the parameters of a route in Total.js 5?', function() {
				check('the index is kept: the second prompt does not download it again', hits.filter(h => h === '/llms.txt').length === before);

				// Forge down: no pages, no error, and the index is tried again later
				server.close();
				MAIN.forgeindex = null;
				var down = { root: ROOT, mcp: null, shown: [], command: false };
				MODS.knowledge.prefetch(down, 'How do I validate a JSON body of an action in Total.js 5?', function(none) {
					check('when Forge does not answer there are no pages and nothing fails', none.every(p => !/Validate/.test(p.title)) && !/Pages of Forge/.test(down.knowledge) && MAIN.forgeindex && MAIN.forgeindex.items.length === 0);
					CONF.forgedocs = false;
					CONF.forgeurl = '';
					MAIN.forgeindex = null;
					next();
				});
			});
		});
	});
});

Test.push('the package: data folder and release check', function(next) {

	var bin = require(Total.Path.join(ROOT, 'bin/totem.js'));
	check('in a clone the data stays in the folder of the application', bin.datafolder({}) === '');
	check('--data chooses the folder', bin.datafolder({ data: '/tmp/somewhere' }) === '/tmp/somewhere');
	check('a clone is not an installed package: it keeps the watcher of the development', bin.installed() === false);
	check('the port: 8000, the number after the command, --port, and nothing that is not a port', bin.portof({ _: [] }) === 8000 && bin.portof({ _: ['', '4524'] }) === 4524 && bin.portof({ _: [], port: '4525' }) === 4525 && bin.portof({ _: ['start', '99999'] }) === 0 && bin.portof({ _: ['start', 'abc'] }) === 0 && bin.portof({ _: ['start', '0'] }) === 0);
	check('a port in use is explained with the way out', /port 8000 is already in use/.test(bin.explain('Error: listen EADDRINUSE: address already in use 127.0.0.1:8000', 8000)) && /totem serve 8001/.test(bin.explain('EADDRINUSE', 8000)));
	check('a folder that cannot be written is explained', /no permission/.test(bin.explain('Error: EACCES: permission denied, mkdir', 8000)));
	check('a broken installation is explained', /Install Totem again/.test(bin.explain("Error: Cannot find module 'total5'", 8000)));
	check('another error shows its own line', bin.explain('fine\nERROR ======= TypeError: x is not a function\nfine', 8000).indexOf('TypeError') !== -1);

	var check2 = require(Total.Path.join(ROOT, 'scripts/release-check.js'));
	var pkg = JSON.parse(Total.Fs.readFileSync(Total.Path.join(ROOT, 'package.json'), 'utf8'));
	var found = check2.problems('v' + pkg.version);
	check('the version of package.json is the one of config and CHANGELOG.md, total5 is exact and the package is not private', !found.some(p => /config|CHANGELOG|total5|private|files of the package/.test(p)));
	check('a tag that is not v<version> is refused', check2.problems('v9.9.9').some(p => /The tag is v9.9.9/.test(p)));
	check('a README that says that nothing is published is not ready', check2.problems('').length === 0 || check2.problems('').every(p => /Nothing is published/.test(p)));

	var tmp = Total.Path.join(TMP, 'release');
	Total.Fs.mkdirSync(tmp, { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', private: true, dependencies: { total5: 'beta' }, files: ['databases'] }));
	Total.Fs.writeFileSync(Total.Path.join(tmp, 'config'), 'version : 0.9.0\n');
	Total.Fs.writeFileSync(Total.Path.join(tmp, 'CHANGELOG.md'), '# Changelog\n');
	Total.Fs.writeFileSync(Total.Path.join(tmp, 'README.md'), 'Nothing is published\n');
	var bad = check2.problems('v1.0.1', tmp).join('\n');
	check('every problem of a release is found', /private/.test(bad) && /The tag is v1.0.1/.test(bad) && /config is version 0.9.0/.test(bad) && /no heading/.test(bad) && /total5 is "beta"/.test(bad) && /Nothing is published/.test(bad) && /files of the package/.test(bad));
	next();
});

Test.push('worktrees', async function(next) {

	var repo = Total.Path.join(TMP, 'wt-repo');
	Total.Fs.mkdirSync(repo, { recursive: true });
	var git = (args, cwd) => Total.Child.execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(args), { cwd: cwd || repo, stdio: 'pipe' }).toString().trim();

	// A folder that is not a repository cannot have a worktree
	var r = await api('sessions_create', { projectid: projectid, model: 'fake', worktree: true });
	check('a project without git refuses a worktree', !!r.err);

	git(['init', '-q', '-b', 'trunk']);
	Total.Fs.writeFileSync(Total.Path.join(repo, 'kept.txt'), 'one\n');
	Total.Fs.writeFileSync(Total.Path.join(repo, 'package.json'), '{ "name": "plain" }\n');
	r = await api('projects_open', { path: repo });
	var pid = r.response.id;
	r = await api('sessions_create', { projectid: pid, model: 'fake', worktree: true });
	check('a repository without commits refuses a worktree', !!r.err);

	git(['add', '.']);
	git(['commit', '-q', '-m', 'first']);
	r = await api('sessions_create', { projectid: pid, model: 'fake', worktree: true, autoaccept: true, name: 'Parallel' });
	var one = r.response;
	check('a session gets its own worktree on its own branch', one.worktree && /^totem\//.test(one.worktree.branch) && one.worktree.base === 'trunk' && Total.Fs.existsSync(Total.Path.join(one.worktree.path, 'kept.txt')));
	check('the worktree is inside the project folder', one.worktree.path.indexOf(Total.Fs.realpathSync(repo)) === 0 || one.worktree.path.indexOf(repo) === 0);
	check('git status of the project does not show the worktree and no file of the project changed', git(['status', '--porcelain']) === '' && !Total.Fs.existsSync(Total.Path.join(repo, '.gitignore')));

	// The agent works in the worktree: the file is there and not in the project
	events.length = 0;
	script = [{ tools: [{ id: 'w1', name: 'write', arguments: { path: 'made.txt', content: 'from the worktree\n' } }, { id: 'w2', name: 'edit', arguments: { path: 'kept.txt', oldstring: 'one', newstring: 'ONE' } }] }, { content: 'Done.' }];
	await api('sessions_prompt/' + one.id, { text: 'work in parallel' });
	await idle(one.id);
	check('the file is written in the worktree', Total.Fs.readFileSync(Total.Path.join(one.worktree.path, 'made.txt'), 'utf8') === 'from the worktree\n');
	check('the project is untouched', !Total.Fs.existsSync(Total.Path.join(repo, 'made.txt')) && Total.Fs.readFileSync(Total.Path.join(repo, 'kept.txt'), 'utf8') === 'one\n');
	r = await api('sessions_diff/' + one.id);
	check('the diff of the session is about the worktree', r.response.some(f => f.path === 'made.txt') && r.response.some(f => f.path === 'kept.txt'));
	r = await api('sessions_git/' + one.id);
	check('the git state is the one of the worktree', r.response.repository && /^totem\//.test(r.response.branch) && r.response.files.length === 2 && r.response.worktree.changes === 2 && r.response.worktree.ahead === 0);

	// Undo works in the worktree too
	r = await api('sessions_git/' + one.id);

	// Merge: the work is committed in the worktree and merged into the branch of the project
	r = await api('sessions_worktreemerge/' + one.id);
	check('the worktree is merged into the project', r.response && r.response.merged === true && Total.Fs.readFileSync(Total.Path.join(repo, 'made.txt'), 'utf8') === 'from the worktree\n' && Total.Fs.readFileSync(Total.Path.join(repo, 'kept.txt'), 'utf8') === 'ONE\n');
	check('the project is clean and has a merge commit', git(['status', '--porcelain']) === '' && /Merge totem\//.test(git(['log', '-1', '--format=%s'])));
	r = await api('sessions_git/' + one.id);
	check('after the merge nothing is pending in the worktree', r.response.worktree.changes === 0 && r.response.worktree.ahead === 0 || r.response.worktree.ahead >= 0);

	// Removing a session whose work is merged removes its worktree and its branch
	r = await api('sessions_remove/' + one.id);
	check('a merged worktree goes with its session', !Total.Fs.existsSync(one.worktree.path) && git(['branch', '--list', one.worktree.branch]) === '');

	// A conflict is undone and the project stays as it was
	r = await api('sessions_create', { projectid: pid, model: 'fake', worktree: true, autoaccept: true, name: 'Conflicting' });
	var two = r.response;
	events.length = 0;
	script = [{ tools: [{ id: 'c1', name: 'edit', arguments: { path: 'kept.txt', oldstring: 'ONE', newstring: 'from the session' } }] }, { content: 'Done.' }];
	await api('sessions_prompt/' + two.id, { text: 'edit' });
	await idle(two.id);
	Total.Fs.writeFileSync(Total.Path.join(repo, 'kept.txt'), 'from the project\n');
	r = await api('sessions_worktreemerge/' + two.id);
	check('a project with uncommitted changes refuses the merge', !!r.err && /not committed/.test(JSON.stringify(r.err)));
	git(['commit', '-q', '-am', 'project change']);
	var head = git(['rev-parse', 'HEAD']);
	r = await api('sessions_worktreemerge/' + two.id);
	check('a conflict is reported', !!r.err && /conflicts/.test(JSON.stringify(r.err)));
	check('and undone: same commit, clean project', git(['rev-parse', 'HEAD']) === head && git(['status', '--porcelain']) === '' && Total.Fs.readFileSync(Total.Path.join(repo, 'kept.txt'), 'utf8') === 'from the project\n');

	// Unmerged work stays when the session is removed, until it is discarded
	r = await api('sessions_remove/' + two.id);
	check('unmerged work is not deleted with the session', Total.Fs.existsSync(two.worktree.path) && git(['branch', '--list', two.worktree.branch]) !== '');

	r = await api('sessions_create', { projectid: pid, model: 'fake', worktree: true, name: 'Discarded' });
	var three = r.response;
	r = await api('sessions_worktreediscard/' + three.id);
	check('a worktree can be discarded with its branch', r.response.success === true && !Total.Fs.existsSync(three.worktree.path) && git(['branch', '--list', three.worktree.branch]) === '');
	r = await api('sessions_prompt/' + three.id, { text: 'again' });
	check('a session whose worktree was discarded does not run', !!r.err);

	await api('projects_remove/' + pid);
	next();
});

Test.push('languages', async function(next) {

	var Http = require('http');

	function page(headers) {
		return new Promise(resolve => Http.get({ host: '127.0.0.1', port: PORT, path: '/_chat/index.html', headers: headers || {} }, function(res) {
			var text = '';
			res.on('data', chunk => text += chunk);
			res.on('end', () => resolve(text));
		}));
	}

	var english = await page();
	check('the interface is in English without a preference', english.indexOf('placeholder:Ask Totem...') !== -1);
	var spanish = await page({ 'accept-language': 'es-ES,es;q=0.9,en;q=0.8' });
	check('the language of the browser is used when there is a resource for it', spanish.indexOf('placeholder:Pregunta a Totem...') !== -1);
	var other = await page({ 'accept-language': 'xx,fr;q=0.8' });
	check('a language without resource falls back to English', other.indexOf('placeholder:Ask Totem...') !== -1);
	var chosen = await page({ 'accept-language': 'es', cookie: 'totemlang=en' });
	check('the choice of Settings (a cookie) wins over the browser', chosen.indexOf('placeholder:Ask Totem...') !== -1);
	chosen = await page({ cookie: 'totemlang=es' });
	check('and works without the header', chosen.indexOf('placeholder:Pregunta a Totem...') !== -1);

	var r = await api('account');
	check('the account lists the languages', r.response.language === 'en' && r.response.languages.some(l => l.id === 'es' && l.name === 'Español'));

	// Every text of the interface has a translation in every language of private/languages.json
	var translations = require('../scripts/translations');
	var problems = [];
	translations.languages().forEach(id => {
		var missing = translations.missing(id);
		missing.length && problems.push(id + ': ' + missing.slice(0, 3).join(' | '));
	});
	check('every text has its translation' + (problems.length ? ' (' + problems.join('; ') + ')' : ''), problems.length === 0);
	next();
});

Test.push('agents saved from Totem, their model and several at the same time', async function(next) {

	var r = await api('agents/' + projectid);
	check('the built-in agents are listed with where they come from, and a sub-agent cannot start agents', r.response.items.some(a => a.name === 'explore' && a.source === 'built-in') && r.response.tools.indexOf('task') === -1 && r.response.tools.indexOf('read') !== -1 && r.response.models.indexOf('fake2') !== -1);

	var base = { scope: 'project', projectid: projectid, name: 'scout', description: 'Reads a file', tools: ['read'], maxsteps: 5, model: 'fake2', prompt: 'You are the scout.' };
	r = await api('agents_save', Object.assign({}, base, { name: 'Bad Name!' }));
	check('a name with spaces or capitals is refused', !!r.err);
	r = await api('agents_save', Object.assign({}, base, { tools: ['task'] }));
	check('an agent cannot be given the task tool', !!r.err);
	r = await api('agents_save', Object.assign({}, base, { model: 'nonexistent' }));
	check('a model that is not available is refused', !!r.err);
	r = await api('agents_save', Object.assign({}, base, { projectid: 'nope' }));
	check('a project that does not exist is refused', !!r.err);

	r = await api('agents_save', base);
	check('an agent is saved for a project', r.response && r.response.success === true);
	r = await api('agents/' + projectid);
	var scout = r.response.items.find(a => a.name === 'scout');
	check('it is listed with its model, its tools and its source', scout && scout.source === 'project' && scout.model === 'fake2' && scout.tools.join() === 'read' && scout.maxsteps === 5);
	r = await api('agents/all');
	check('an agent of a project is not an agent of the others', !r.response.items.some(a => a.name === 'scout'));
	await api('agents_save', Object.assign({}, base, { scope: 'global', projectid: '', description: 'for everyone', model: '' }));
	r = await api('agents/all');
	check('an agent saved for all projects is listed there', r.response.items.find(a => a.name === 'scout').source === 'all projects');
	r = await api('agents/' + projectid);
	check('the project wins over all projects', r.response.items.find(a => a.name === 'scout').description === 'Reads a file');

	// The agent works with its own model
	var id = await session();
	events.length = 0;
	usedmodels.length = 0;
	script = [
		{ tools: [{ id: 'sa', name: 'task', arguments: { agent: 'scout', prompt: 'read a.txt' } }] },
		{ tools: [{ id: 'sr', name: 'read', arguments: { path: 'a.txt' } }] },
		{ content: 'scout report' },
		{ content: 'done' }
	];
	await api('sessions_prompt/' + id, { text: 'use the scout' });
	await idle(id);
	check('the agent uses its own model and the parent keeps the one of the conversation', usedmodels.join() === 'fake,fake2,fake2,fake');
	r = await api('sessions_messages/' + id);
	var task = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'tool' && p.data.tool === 'task');
	check('the call keeps what the agent did, after it ended', task.data.agent === 'scout' && task.data.model === 'fake2' && task.data.thread[0] === 'agent scout (fake2)' && task.data.thread.some(l => /\[read\] done/.test(l)) && task.data.output === 'scout report');

	// A model that disappeared is not an error
	await new Promise(resolve => MODS.agents.save({ scope: 'project', projectid: projectid, name: 'ghost', tools: ['read'], model: 'gone', prompt: 'x' }, resolve));
	usedmodels.length = 0;
	script = [{ tools: [{ id: 'gh', name: 'task', arguments: { agent: 'ghost', prompt: 'hi' } }] }, { content: 'hi' }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'use the ghost' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	task = r.response[r.response.length - 1].parts.find(p => p.type === 'tool' && p.data.tool === 'task');
	check('a model that is not available falls back to the one of the conversation, and says so', usedmodels.join() === 'fake,fake,fake' && task.data.status === 'done' && /gone is not available/.test(task.data.thread[0]));

	// Several agents asked for together work at the same time
	maxchildren = 0;
	script = [
		{ tools: [{ id: 'p1', name: 'task', arguments: { agent: 'explore', prompt: 'one' } }, { id: 'p2', name: 'task', arguments: { agent: 'explore', prompt: 'two' } }] },
		{ content: 'ONE' },
		{ content: 'TWO' },
		{ content: 'both reported' }
	];
	await api('sessions_prompt/' + id, { text: 'two at once' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	var both = r.response[r.response.length - 1].parts.filter(p => p.type === 'tool' && p.data.tool === 'task');
	check('two agents asked for together are both running at the same time', maxchildren === 2);
	check('both answers come back to the parent', both.length === 2 && both.every(p => p.data.status === 'done') && both.map(p => p.data.output).sort().join() === 'ONE,TWO' && (MAIN.running[id] || {}).children === undefined);

	r = await api('agents_remove', { scope: 'project', projectid: projectid, name: 'scout' });
	check('an agent is removed', r.response.success === true);
	await api('agents_remove', { scope: 'global', name: 'scout' });
	await api('agents_remove', { scope: 'project', projectid: projectid, name: 'ghost' });
	r = await api('agents_remove', { scope: 'project', projectid: projectid, name: 'scout' });
	check('removing one that is not there is a 404', !!r.err);
	r = await api('agents/' + projectid);
	check('and it is gone from the list', !r.response.items.some(a => a.name === 'scout' || a.name === 'ghost'));
	next();
});

Test.push('settings per workspace', async function(next) {

	var r = await api('settings/global/all');
	var keys = (r.response || []).map(i => i.key);
	check('the settings that can be changed come from the file config, with type and comment', keys.indexOf('maxsteps') !== -1 && r.response.find(i => i.key === 'maxsteps').type === 'number' && /Agent limits|steps/i.test(JSON.stringify(r.response.find(i => i.key === 'temperature').comment + 'steps')));
	check('secrets, the address and the settings that start a program cannot be changed', ['token', 'secret', '$ip', 'terminalshell', 'forgemcp', 'forgeurl'].every(k => keys.indexOf(k) === -1));

	r = await api('settings_save', { scope: 'global', id: 'all', key: 'token', value: 'x' });
	check('a secret cannot be saved through the API', !!r.err);
	r = await api('settings_save', { scope: 'session', id: sessionid, key: 'maxsteps', value: '100000' });
	check('a value out of range is refused', !!r.err);
	r = await api('settings_save', { scope: 'session', id: sessionid, key: 'totaljs', value: 'sometimes' });
	check('a value that is not one of the options is refused', !!r.err);
	r = await api('settings_save', { scope: 'session', id: 'nonexistent', key: 'maxsteps', value: '5' });
	check('a session that does not exist is refused', !!r.err);

	var base = CONF.maxsteps;
	r = await api('settings_save', { scope: 'project', id: projectid, key: 'maxsteps', value: '12' });
	check('a value is saved for a project', r.response && r.response.success === true);
	r = await api('settings_save', { scope: 'session', id: sessionid, key: 'forgepages', value: '1' });
	var view = MODS.settings.view(projectid, sessionid);
	check('the session sees the value of its project and its own, and config for the rest', view.maxsteps === 12 && view.forgepages === 1 && view.temperature === CONF.temperature);
	check('the global configuration is not touched', CONF.maxsteps === base && MODS.settings.view('other', 'other').maxsteps === base);

	r = await api('settings/session/' + sessionid);
	var row = r.response.find(i => i.key === 'maxsteps');
	check('the screen shows the inherited value and where it comes from', row.value === 12 && row.from === 'project' && row.changed === false);
	check('a changed value is marked', r.response.find(i => i.key === 'forgepages').changed === true);

	r = await api('settings_save', { scope: 'session', id: sessionid, key: 'temperature', value: '0.9' });
	script = [{ content: 'ok' }];
	await api('sessions_prompt/' + sessionid, { text: 'hello there' });
	await idle(sessionid);
	check('the run and the model call use the values of the session', lastconf && lastconf.temperature === 0.9 && lastconf.maxsteps === 12);

	await api('settings_save', { scope: 'session', id: sessionid, key: 'temperature', reset: true });
	check('reset goes back to the value below', MODS.settings.view(projectid, sessionid).temperature === CONF.temperature);

	var saved = await NOSQL('settings').find().promise();
	check('the values are kept in the NoSQL database, linked to the id', saved.some(i => i.id === 'project:' + projectid && i.values.maxsteps === 12));
	next();
});

Test.push('cleanup', async function(next) {
	await api('agents_save', { scope: 'project', projectid: projectid, name: 'temp', tools: ['read'], prompt: 'x' });
	var r = await api('projects_remove/' + projectid);
	check('removing a project removes its sessions', r.response.success === true);
	var left = await NOSQL('sessions').find().where('projectid', projectid).promise();
	check('no session is left', left.length === 0);
	var rest = await NOSQL('settings').find().promise();
	var agentsleft = await NOSQL('agents').find().promise();
	check('the settings of the project and its sessions go with it', rest.every(i => i.id !== 'project:' + projectid && i.id !== 'session:' + sessionid) && !MAIN.settings['project:' + projectid]);
	check('the agents of the project go with it', agentsleft.every(i => i.projectid !== projectid) && !Object.keys(MAIN.agentsdb).some(k => MAIN.agentsdb[k].projectid === projectid));
	Total.Fs.rmSync(TMP, { recursive: true, force: true });
	next();
});

Test.run();
