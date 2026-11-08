// The agent loop: prompt -> model -> tool calls -> model -> ... until the model answers without tools.
// Events go to the interface through FUNC.emit(); finished parts are stored in NoSQL.

exports.id = 'agent';

// Tools shown to the model: the name, the action that runs it and whether it only reads.
// The definition comes from the action itself (toAITool()).
var TOOLS = {
	read: { action: 'Tools|read', readonly: true },
	glob: { action: 'Tools|glob', readonly: true },
	grep: { action: 'Tools|grep', readonly: true },
	write: { action: 'Tools|write' },
	edit: { action: 'Tools|edit' },
	bash: { action: 'Tools|bash' },
	patch: { action: 'Tools|patch' },
	job: { action: 'Tools|job' },
	fetch: { action: 'Tools|fetch', readonly: true },
	todo: { action: 'Tools|todo' },
	ask: { action: 'Tools|ask' },
	skill: { action: 'Tools|skill', readonly: true },
	task: { action: 'Tools|task' }
};

exports.tools = TOOLS;

// What the Plan mode may use: it reads and asks, it does not change anything
var PLANTOOLS = ['read', 'glob', 'grep', 'fetch', 'todo', 'ask', 'skill', 'task'];
exports.plantools = PLANTOOLS;

// Definitions for the model: the arguments are flattened (the model sends { path }, the action receives { input: { path } })
exports.definitions = function(names, mode) {
	var output = [];
	for (var name in TOOLS) {
		if (names && names.indexOf(name) === -1)
			continue;
		if (mode === 'plan' && PLANTOOLS.indexOf(name) === -1)
			continue;
		var action = F.actions[TOOLS[name].action];
		if (!action)
			continue;
		var meta = action.toAITool();
		var schema = meta.inputSchema.properties.input || { type: 'object', properties: {} };
		output.push({ type: 'function', function: { name: name, description: meta.description, parameters: { type: 'object', properties: schema.properties || {}, required: schema.required || [] } } });
	}
	return output;
};

function system(run) {

	var text = MAIN.base;
	if (run.mode === 'plan')
		text += '\n' + MAIN.plan + '\n';
	text += '\nWorking directory: {0}\nPlatform: {1}\nDate: {2}\n'.format(run.root, Total.Os.platform(), new Date().format('yyyy-MM-dd'));

	// Total.js is the default: the rules, a few examples and where to look things up
	if (MODS.instructions.istotaljs(run.root, run.conf))
		text += '\n' + MODS.instructions.primer() + '\n';

	var instructions = MODS.instructions.text(run.root);
	if (instructions)
		text += '\nInstructions of this project (AGENTS.md):\n' + instructions + '\n';

	// The pages of Forge that the search found for this request
	if (run.knowledge)
		text += '\n' + run.knowledge + '\n';
	if (run.bootstrapped)
		text += '\nThe starter tool results are in the conversation. Keep created files; implement only requirements that remain, using tools. Report briefly in the language of the original request. Do not repeat the starter source or claim that a test ran without its tool result.\n';

	var agents = MODS.agents.list(run.root, run.projectid);
	if (agents.length) {
		text += '\nAgents you can delegate to with the task tool. They have their own context and return only their final answer:\n';
		for (var agent of agents)
			text += '- {0}: {1}\n'.format(agent.name, agent.description);
	}

	var skills = MODS.instructions.skills(run.root);
	if (skills.length) {
		text += '\nSkills of this project. Load one with the skill tool when it applies:\n';
		for (var skill of skills)
			text += '- {0}: {1}\n'.format(skill.name, skill.description);
	}

	return text;
}

// Rough size of the request in tokens
function estimate(messages) {
	var size = 0;
	for (var m of messages)
		size += contentsize(m.content) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
	return Math.ceil(size / 4);
}

// The content of a message is a text or a list of parts; an image counts as about a thousand tokens
function contentsize(content) {

	if (!content)
		return 0;

	if (typeof(content) === 'string')
		return content.length;

	return content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 4000), 0);
}

// The text of a content, for the summary
function textof(content) {

	if (!content)
		return '';

	if (typeof(content) === 'string')
		return content;

	return content.map(part => part.type === 'text' ? part.text : '[image]').join('\n');
}

// The last message of the user in a Total.js project ends with a reminder: a small model follows the end of the conversation better than the
// beginning. It is about the style and about not inventing; the user interface is only mentioned when the request is about one (a reminder
// that always says "jComponent" makes a model put jComponent in a route).
var STYLE = 'indent with TABS, ES5 (var and function, no =>, const, let or template literals), texts for people marked for translation as the recipes show, the modules of Node.js through Total (Total.Fs, Total.Os, Total.Path...) and never require(). Follow the recipes and the pages above; when they do not have what you need, look for it in the documentation of Total.js before you answer, and ask the user for more information only if you find nothing. Do not invent a function. Reply in the language of the user.';
var ANSWER = ' Put code in Markdown fences with the language (js, html or json) and its file path on the preceding line. Use tools only to read or change files of the project.';
var CREATE = ' The user wants it made: create the files with the write tool (the path the user gave; for Total.js code, schemas/ for actions and controllers/ for routes), then say in one sentence what you created. Never make files with shell commands (echo, cat): show each file as a code block with its path on the line before it.';
var REMINDER = '\n\n(Total.js 5, in its style: ' + STYLE;
var REMINDERUI = '\n\n(Total.js 5 and jComponent 20, the interface library of Total.js. Style: ' + STYLE;
var MAKE = /\b(crea|crear|cr[eé]ame|haz|hazme|genera|generar|guarda|guardar|gu[aá]rdalo|save|a[ñn]ade|agrega|escribe|implementa|create|make|add|write|generate|build|implement)\b/i;
// The first line of a code block that says where it goes: // schemas/system.js, <!-- plugins/x/index.html --> or # path
var PATHCOMMENT = /^\s*(?:\/\/|<!--|#)\s*([A-Za-z0-9_@\-.\/]+\.[A-Za-z0-9]+)\s*(?::.*|-->)?\s*$/;

// The code blocks of an answer with a path that is inside the project and does not exist yet: [{ path, content }], at most twenty-four
function newfiles(run, text) {

	var files = [];
	var seen = {};
	var regex = /```([A-Za-z0-9_+-]*)([^\n]*)\n([\s\S]*?)```/g;
	var match;

	while ((match = regex.exec(text || '')) && files.length < 24) {

		var code = match[3];
		var path = PATHCOMMENT.exec(code.split('\n')[0]);
		if (!path)
			path = match[2].trim().match(/^(?:filename=)?([A-Za-z0-9_@.\/-]+\.[A-Za-z0-9]+)$/);

		// Without a comment: a preceding filename on a creation request, or a file the user explicitly named.
		if (!path && !/^(bash|sh|shell|zsh|console|cmd|powershell)$/i.test(match[1])) {
			var before = text.substring(Math.max(0, match.index - 160), match.index);
			var named = before.match(/(?:`|\*\*)([A-Za-z0-9_\-.\/]+\.[A-Za-z0-9]+|config)(?:`|\*\*)(?![\s\S]*(?:`|\*\*)[A-Za-z0-9_\-.\/]+\.[A-Za-z0-9]+(?:`|\*\*))/);
			if (named && (run.make || (run.asked || '').indexOf(named[1]) !== -1))
				path = [named[0], named[1]];
		}

		if (!path || path[1].indexOf('..') !== -1 || path[1].charAt(0) === '/' || seen[path[1]])
			continue;

		var full = FUNC.resolve(run.root, path[1]);

		if (!full || Total.Fs.existsSync(full) || /(^|\/)\.git(\/|$)|(^|\/)\.env/.test(path[1]))
			continue;

		seen[path[1]] = true;
		files.push({ path: path[1], content: code.replace(/\s+$/, '') + '\n' });
	}

	return files;
}

exports.newfiles = newfiles;

// A model of up to 4 billion parameters by its name (qwen2.5:1.5b, llama3.2:3b, phi3:3.8b)
function smallmodel(id) {
	// The name of the model, or the model behind it when a gateway (LiteLLM) gave another name: qwen-local is ollama/qwen2.5:1.5b
	var names = [id || '', ((MAIN.modelmeta || {})[id] || {}).underlying || ''];
	for (var name of names) {
		var match = /[:\-_](\d+(?:\.\d+)?)b\b/i.exec(name);
		if (match && +match[1] <= 4)
			return true;
	}
	return false;
}

exports.smallmodel = smallmodel;

// The limit of tokens for one answer of a model of this computer (0 when there is none)
function predictlimit(id, conf) {
	conf = conf || CONF;
	var limit = +conf.ollamapredict || 0;
	if (conf.ollamapredictsmall && smallmodel(id))
		limit = limit ? Math.min(limit, +conf.ollamapredictsmall) : +conf.ollamapredictsmall;
	return limit;
}

// A request that is about the files of the project: a path, a file name or a word of working with them
var FILEISH = /[\w-]+\/[\w.-]+|\b[\w-]+\.(js|html|css|json|md|txt|ts|py)\b|\b(archivo|archivos|fichero|file|files|carpeta|folder|proyecto|project|lee|leer|lee|read|edit|edita|editar|modifica|cambia|cambiar|change|fix|arregla|corrige|ejecuta|ejecutar|run|test|tests|git|commit|busca|search|grep)\b/i;

// A greeting, a thanks or a question about Totem is a conversation: it gets no reminder of the style
var TALK = /^\s*(hola|buenas|buenos|hello|hi|hey|gracias|thanks|thank you|ok|vale|qu[eé] puedes|qu[eé] sabes|what can you|who are you|qui[eé]n eres)\b/i;
var UIWORDS = /jcomponent|ui-component|ui-plugin|\bcomponent|\bplugin\b|\bform\b|\bbutton|\bscreen|\bpage\b|\bhtml\b|\btable\b|\binterface|\bfrontend|\bpantalla|formulario|bot[oó]n|componente|interfaz|tangular|\bui\b/i;

function textof(content) {
	return Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join(' ') : (content || '');
}

// mode: in Build mode a request to make something is answered by making the files
function reminderof(content, mode) {
	var text = textof(content);
	if (/^\s*(?:what is|qu[eé] es)\b/i.test(text) && !/example|ejemplo|code|c[oó]digo/i.test(text))
		return '\n\n(Explain the concept briefly in the language of the user. No code or comparisons unless requested.)';
	return (UIWORDS.test(text) ? REMINDERUI : REMINDER) + (mode === 'build' && MAKE.test(text) ? CREATE : ANSWER) + ')';
}

// The last prompt of the user is too short to be a request for code ("hola", "thanks")
function shortprompt(messages) {
	var last = messages[messages.length - 1];
	return !!last && last.role === 'user' && (contentsize(last.content) < 12 || TALK.test(textof(last.content)));
}

// The last message, when it is the one of the user, ends with the reminder
function withreminder(messages, mode) {

	var last = messages[messages.length - 1];

	if (!last || last.role !== 'user')
		return messages;

	var copy = messages.slice();
	var reminder = reminderof(last.content, mode);

	if (Array.isArray(last.content))
		copy[copy.length - 1] = Object.assign({}, last, { content: last.content.map((part, index) => index === 0 && part.type === 'text' ? Object.assign({}, part, { text: part.text + reminder }) : part) });
	else
		copy[copy.length - 1] = Object.assign({}, last, { content: (last.content || '') + reminder });

	return copy;
}

// Older answers of the assistant without their code blocks: a small model that sees its own code in the history writes it again for any prompt.
// The last user prompt and what follows it stay as they are.
function lighthistory(messages) {

	var last = -1;
	for (var i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			last = i;
			break;
		}
	}

	return messages.map(function(m, index) {
		if (index >= last || m.role !== 'assistant' || typeof(m.content) !== 'string' || m.content.indexOf('```') === -1)
			return m;
		return Object.assign({}, m, { content: m.content.replace(/```[\s\S]*?(```|$)/g, '(code omitted)').trim() });
	});
}

// A model that cannot see gets the text of the prompt and a note in place of each image
function withoutimages(messages) {
	return messages.map(function(m) {
		if (!Array.isArray(m.content))
			return m;
		var text = m.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
		var count = m.content.length - m.content.filter(part => part.type === 'text').length;
		return Object.assign({}, m, { content: text + (count ? ('\n[{0} image{1} omitted: this model cannot read images]'.format(count, count > 1 ? 's' : '')) : '') });
	});
}

// Level 1 of compaction: the output of old tool calls becomes one line. The stored history is not touched.
function trimoutput(messages, keep) {
	var count = 0;
	for (var i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'tool' && ++count > keep && messages[i].content.length > 200)
			messages[i] = { role: 'tool', tool_call_id: messages[i].tool_call_id, content: '[output omitted: {0} characters]'.format(messages[i].content.length) };
	}
}

// Level 2: the older turns become a summary written by the model of the session. callback(err)
function summarize(run, callback) {

	var cut = Math.max(run.messages.length - 8, 0);

	// Never separate a tool call from its results
	while (cut > 0 && run.messages[cut].role === 'tool')
		cut--;

	if (cut < 2) {
		callback();
		return;
	}

	var older = run.messages.slice(0, cut);
	var transcript = older.map(m => (m.role + ': ' + (textof(m.content) || (m.tool_calls ? JSON.stringify(m.tool_calls) : ''))).substring(0, 1500)).join('\n');

	var ai = AIMODEL(run.model);
	ai.conf = run.conf;
	ai.payload.messages = [
		{ role: 'system', content: 'Summarize the conversation for an assistant that continues the work. Keep goals, decisions, files changed and open problems. Under 300 words.' },
		{ role: 'user', content: transcript }
	];

	ai.callback(function(err, output) {
		if (err || !output || !output.content) {
			callback();
			return;
		}
		run.messages = [{ role: 'user', content: 'Summary of the earlier conversation:\n' + output.content }].concat(run.messages.slice(cut));
		addpart(run, 'compaction', { removed: older.length, summary: output.content }, true);
		callback();
	});
}

function compact(run, callback) {

	// The window of the model when it is known, with room for the answer; otherwise the configured limit
	var meta = (MAIN.modelmeta && MAIN.modelmeta[run.model]) || {};
	var window = meta.window || meta.context;
	var limit = window ? Math.floor(window * 0.8) : run.conf.contextlimit;

	if (estimate(run.messages) <= limit) {
		callback();
		return;
	}

	trimoutput(run.messages, 6);

	if (estimate(run.messages) <= limit) {
		callback();
		return;
	}

	summarize(run, callback);
}

function retryable(err) {
	return typeof(err) === 'string' && /^(429|5\d\d)\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|network|fetch failed|Timeout/i.test(err);
}

// The signature that Gemini 3 asks to receive back with a function call
exports.withsignature = withsignature;

function withsignature(call, signature) {
	if (signature)
		call.thoughtSignature = signature;
	return call;
}

// Converts the stored parts of a session into the messages of the provider
function history(messages, parts) {

	var output = [];
	var byid = {};

	for (var part of parts) {
		if (!byid[part.messageid])
			byid[part.messageid] = [];
		byid[part.messageid].push(part);
	}

	for (var message of messages) {

		var items = (byid[message.id] || []).sort((a, b) => a.seq - b.seq);

		if (message.role === 'user') {

			var text = '';
			var images = [];

			for (var item of items) {
				if (item.type === 'text')
					text += item.data.expanded || item.data.text;
				else if (item.type === 'file' && item.data.kind === 'text')
					text += '\n\n<file name="{0}">\n{1}\n</file>'.format(item.data.name, MODS.attachments.text(item.data.id) || '(the file is not available)');
				else if (item.type === 'file' && item.data.kind === 'image')
					images.push(item.data);
			}

			if (!images.length) {
				output.push({ role: 'user', content: text });
				continue;
			}

			// With images the content is a list: the text, then each image as a data URL
			var content = [{ type: 'text', text: text }];

			for (var image of images) {
				var url = MODS.attachments.dataurl(image);
				if (url)
					content.push({ type: 'image_url', image_url: { url: url } });
				else
					content[0].text += '\n[the image {0} is not available]'.format(image.name);
			}

			output.push({ role: 'user', content: content });
			continue;
		}

		var content = '';
		var calls = [];
		var results = [];

		var flush = function() {
			if (!content && !calls.length)
				return;
			var msg = { role: 'assistant', content: content || null };
			if (calls.length)
				msg.tool_calls = calls;
			output.push(msg);
			for (var result of results)
				output.push(result);
			content = '';
			calls = [];
			results = [];
		};

		for (var part of items) {
			if (part.type === 'text')
				content += part.data.text;
			else if (part.type === 'tool') {
				calls.push(withsignature({ id: part.data.call, type: 'function', function: { name: part.data.tool, arguments: JSON.stringify(part.data.input || {}) } }, part.data.thoughtSignature));
				results.push({ role: 'tool', tool_call_id: part.data.call, content: part.data.error ? ('Error: ' + part.data.error) : (part.data.output || '') });
			} else if (part.type === 'step')
				flush();
		}

		flush();
	}

	return output;
}

exports.history = history;
exports.lighthistory = lighthistory;

// Starts a run. The user message is already stored. callback(err) is called when the run ends.
exports.run = function(session, project, message, callback) {

	var conf = MODS.settings.view(project.id, session.id);

	var run = {
		sessionid: session.id,
		projectid: project.id,
		root: project.path,
		autoaccept: !!session.autoaccept,
		unattended: !!session.unattended,
		mode: session.mode === 'plan' ? 'plan' : 'build',
		aborted: false,
		steps: 0,
		max: session.maxsteps || conf.maxsteps,
		conf: conf,
		model: session.model,
		parts: {},
		seq: 0,
		attempts: 0,
		denials: 0,
		reasoning: session.reasoning || '',
		open: {},
		messages: [],
		ai: null
	};

	MAIN.running[session.id] = run;

	function finish(status, error) {
		MODS.mcpclient.close(run);
		delete MAIN.running[session.id];
		NOSQL('sessions').modify({ status: status, dtupdated: NOW }).where('id', session.id).callback(NOOP);

		// The error comes first so that a client that stops at the final status has already seen it
		if (error)
			FUNC.emit(session.id, 'error', { message: error, retry: false });

		FUNC.emit(session.id, 'session.status', { status: status });
		callback && callback(error || null);
	}

	function fail(error) {
		closeparts(run);
		finish('error', error);
	}

	FUNC.emit(session.id, 'session.status', { status: 'running' });
	NOSQL('sessions').modify({ status: 'running', dtupdated: NOW }).where('id', session.id).callback(NOOP);

	// The assistant message of this run
	var assistant = { id: UID(), sessionid: session.id, role: 'assistant', model: session.model, dtcreated: FUNC.stamp() };
	run.message = assistant;
	NOSQL('messages').insert(assistant).callback(NOOP);
	FUNC.emit(session.id, 'message.created', { message: assistant });

	NOSQL('messages').find().where('sessionid', session.id).sort('dtcreated').callback(function(err, messages) {
		NOSQL('parts').find().where('sessionid', session.id).sort('dtcreated').callback(function(err, parts) {

			// The new assistant message has no parts yet: it is not part of the history
			messages = messages.filter(m => m.id !== assistant.id);

			run.messages = history(messages, parts);

			// What the last turn already put in front of the model, and whether the prompt is a command (its text is a fixed instruction, not a question)
			var lastuser = messages.filter(m => m.role === 'user').pop();
			run.command = !!(lastuser && parts.some(p => p.messageid === lastuser.id && p.type === 'text' && p.data && p.data.expanded));
			run.init = !!(run.command && parts.some(p => p.messageid === lastuser.id && p.type === 'text' && p.data && /^\/init\b/.test(p.data.text || '')));
			run.newapp = !!(run.command && parts.some(p => p.messageid === lastuser.id && p.type === 'text' && p.data && /^\/new\b/.test(p.data.text || '')));
			run.newname = run.newapp ? ((parts.find(p => p.messageid === lastuser.id && p.type === 'text' && p.data && p.data.text) || { data: { text: '' } }).data.text.replace(/^\/new\s*/, '')) : '';
			var lastknowledge = parts.filter(p => p.type === 'knowledge' && p.data && p.data.recipes).pop();
			run.shown = lastknowledge ? lastknowledge.data.recipes : [];

			// A small local model copies the code of its own earlier answers, whatever is asked next
			if (run.conf.lighthistory !== false && smallmodel(run.model))
				run.messages = lighthistory(run.messages);

			// The MCP servers of the project that the user allows; their tools join the ones of Totem
			MODS.mcpclient.connect(run, function() {

				// The pages of Forge that match the request go into the prompt, so that even a small model starts from the documentation
				var last = run.messages[run.messages.length - 1];
				var asked = last && last.role === 'user' ? textof(last.content) : '';

				// A follow-up page request keeps the topic of the preceding user request (not arbitrary older turns).
				var lookup = asked;
				if (/\bhtml\b/i.test(asked) && /complet|full|standalone|que lo muestre/i.test(asked)) {
					var previous = run.messages.slice(0, -1).filter(m => m.role === 'user').pop();
					if (previous)
						lookup += '\nPrevious request: ' + textof(previous.content).substring(0, 1000);
				}

				MODS.knowledge.prefetch(run, lookup, function(pages) {
					if (pages.length)
						addpart(run, 'knowledge', { pages: pages, recipes: run.recipeids || [] }, true);

					// A small model that is asked to show or explain something, with the recipe in front of it, answers with it: with the tools in
					// its hand it goes to read files that do not exist. It keeps them for the requests that make or change something.
					run.asked = asked;
					run.make = !!(run.init || (!run.command && MAKE.test(asked)));
					run.question = !!((run.recipeids || []).length && !run.command && smallmodel(run.model) && !MAKE.test(asked) && !FILEISH.test(asked));
					step(run, finish, fail);
				});
			});
		});
	});
};

function step(run, finish, fail) {

	if (run.aborted) {
		closeparts(run);
		finish('aborted');
		return;
	}

	if (run.steps >= run.max) {
		closeparts(run);
		finish('error', '@(Step limit reached)');
		return;
	}

	// A model that keeps trying what the user rejected is stopped: the user decides how to continue
	if (run.denials >= 3) {
		closeparts(run);
		addpart(run, 'text', { text: 'Stopped: the last 3 actions were rejected. Tell me how you want to continue.' }, true);
		finish('idle');
		return;
	}

	// /new: fixed files, written with the write tool (with its permission, its diff and its undo), the same for every model
	if (run.newapp && !run.newdone) {

		run.newdone = true;
		var scaffold = MODS.commands.scaffold(run.root, run.newname);

		if (!scaffold.files.length) {
			addpart(run, 'text', { text: 'Everything of a new application is already here, so I changed nothing.' }, true);
			closeparts(run);
			finish('idle');
			return;
		}

		// The user typed /new: the files are fixed and new, so there is nothing to ask about each of them (plan mode still refuses every write)
		run.autoaccept = true;

		runtools(run, scaffold.files.map(file => ({ id: 'w' + UID(), name: 'write', arguments: { path: file.path, content: file.content } })), function() {
			var written = scaffold.files.filter(file => Total.Fs.existsSync(Total.Path.join(run.root, file.path))).length;
			addpart(run, 'text', { text: written ? ('Created ' + written + ' of the ' + scaffold.files.length + ' files of a Total.js 5 application' + (scaffold.skipped.length ? ' (left as they were: ' + scaffold.skipped.join(', ') + ')' : '') + '. To run it: `npm install` and then `npm start`, and open http://127.0.0.1:8000/.') : 'No file was created.' }, true);
			closeparts(run);
			finish('idle');
		});
		return;
	}

	// A small model should build features on a valid starter instead of inventing the framework's boot sequence.
	if (!run.bootstrapped && !run.command && run.mode === 'build' && smallmodel(run.model) &&
		MODS.knowledge.apprequest(run.asked) &&
		MODS.instructions.istotaljs(run.root, run.conf) && !Total.Fs.existsSync(Total.Path.join(run.root, 'package.json'))) {
		run.bootstrapped = true;
		var starter = MODS.commands.scaffold(run.root, '', run.asked);
		var calls = starter.files.map(function(file) { return { id: 'w' + UID(), name: 'write', arguments: { path: file.path, content: file.content } }; });
		run.messages.push({ role: 'assistant', content: null, tool_calls: calls.map(function(t) { return { id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments) } }; }) });
		runtools(run, calls, function() {
			step(run, finish, fail);
		});
		return;
	}

	// /init with a model of up to 4 billion parameters: it cannot write AGENTS.md from the facts (it says that the folder is empty or loops). The file is
	// made from the files of the project and written with the write tool, with its permission and its diff.
	if (run.init && smallmodel(run.model) && !run.initdone && run.conf.initsmall !== false) {

		run.initdone = true;
		var content = MODS.commands.agents(run.root);

		if (!content) {
			addpart(run, 'text', { text: 'AGENTS.md already exists, so I left it as it is. Tell me what to change in it.' }, true);
			closeparts(run);
			finish('idle');
			return;
		}

		runtools(run, [{ id: 'w' + UID(), name: 'write', arguments: { path: 'AGENTS.md', content: content } }], function() {
			addpart(run, 'text', { text: 'I wrote AGENTS.md from the files of this project. Read it and tell me what to add.' }, true);
			closeparts(run);
			finish('idle');
		});
		return;
	}

	run.steps++;

	compact(run, function() {
		request(run, finish, fail);
	});
}

function request(run, finish, fail) {

	if (run.aborted) {
		closeparts(run);
		finish('aborted');
		return;
	}

	var ai = AIMODEL(run.model);
	ai.conf = run.conf;
	ai.payload.messages = [{ role: 'system', content: system(run) }].concat(run.messages);
	ai.payload.small = smallmodel(run.model);
	ai.payload.underlying = ((MAIN.modelmeta || {})[run.model] || {}).underlying || '';

	// A model that is known not to support tools only chats: the request without tools is better than an error
	var meta = (MAIN.modelmeta && MAIN.modelmeta[run.model]) || {};

	// A small model follows the end of the conversation better than the beginning: the prompt of the user, in a Total.js project, carries a
	// short reminder in the request (it is not stored and the user does not see it)
	// Not for a command (its text is a fixed instruction) and not for a greeting: "answer with the code" makes a small model write code for anything
	if (MODS.instructions.istotaljs(run.root, run.conf) && !run.command && !run.complaining && !shortprompt(ai.payload.messages))
		ai.payload.messages = withreminder(ai.payload.messages, run.mode);

	if (meta.vision === false)
		ai.payload.messages = withoutimages(ai.payload.messages);

	ai.payload.tools = (meta.tools === false || run.notools || run.question || run.complaining) ? [] : exports.definitions(null, run.mode).concat(run.mode === 'plan' ? [] : ((run.mcp && run.mcp.defs) || []));
	ai.payload.reasoning = run.reasoning;
	run.ai = ai;
	// Hold Total.js answer text until its checks finish. Tool progress and reasoning still stream.
	run.holdanswer = run.conf.selfcheck !== false && !run.command && MODS.instructions.istotaljs(run.root, run.conf);
	run.draft = '';

	ai.stream(function(e) {
		if (run.aborted)
			return;
		if (e.type === 'content')
			content(run, e.delta, meta.reasoning === true);
		else if (e.type === 'thinking')
			delta(run, 'reasoning', e.delta);
		else if (e.type === 'tool_start')
			toolstart(run, e.tool);
	});

	ai.callback(function(err, output) {

		run.ai = null;
		var reviewing = run.complaining;
		run.complaining = false;
		endcontent(run);

		if (run.aborted) {
			closeparts(run);
			finish('aborted');
			return;
		}

		if (err) {

			var message = typeof(err) === 'string' ? err : (err.message || 'Model error');

			// A server that refuses the images of the prompt: the model cannot see. Try again without them and remember it.
			if (!run.noimages && /multimodal|image|vision/i.test(message) && ai.payload.messages.some(m => Array.isArray(m.content))) {
				run.noimages = true;
				MAIN.modelmeta[run.model] = Object.assign({}, MAIN.modelmeta[run.model], { vision: false });
				run.steps--;
				closeparts(run);
				FUNC.emit(run.sessionid, 'error', { message: 'This model cannot read images: they were left out and the prompt goes without them.', retry: true });
				step(run, finish, fail);
				return;
			}

			// Transient errors are retried with backoff; the partial answer stays stored
			if (retryable(message) && run.attempts < run.conf.retries) {
				run.attempts++;
				run.steps--;
				closeparts(run);
				FUNC.emit(run.sessionid, 'error', { message: message, retry: true });
				setTimeout(() => step(run, finish, fail), run.conf.retrybase * Math.pow(2, run.attempts - 1));
				return;
			}

			fail(message);
			return;
		}

		run.attempts = 0;
		if (run.holdanswer)
			output.content = MODS.conventions.prepare(run.draft || output.content || '', reviewing);
		closeparts(run);

		var tools = output.tools || [];
		var stepdata = { tokens: output.usage || null, finish: tools.length ? 'tools' : 'stop' };

		// The cost in dollars when the model has a price (a free or local model costs nothing)
		var price = (MAIN.modelmeta[run.model] || {}).price;
		if (output.usage && price)
			stepdata.cost = output.usage.input * price.input + output.usage.output * price.output;
		addpart(run, 'step', stepdata, true);

		// The assistant message of this step for the next request
		var msg = { role: 'assistant', content: output.content || null };
		// The thinking of Claude goes back with the tool calls of the same turn (it is not stored: only this run needs it)
		if (tools.length && output.thinkingblocks)
			msg.thinking_blocks = output.thinkingblocks;

		if (tools.length)
			msg.tool_calls = tools.map(t => withsignature({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) } }, t.thoughtSignature));

		// The signatures travel with the stored call so that the history can send them back
		tools.forEach(function(t) {
			var stored = run.parts[t.id];
			if (stored && t.thoughtSignature)
				stored.data.thoughtSignature = t.thoughtSignature;
		});
		// A small model that tries a tool call with a broken JSON makes the server swallow its text: nothing comes back at all. The same request
		// without tools gets the answer that it was going to give.
		if (!tools.length && !(output.content || '').trim() && !(output.thinking || '').trim() && !run.emptyretry) {
			run.emptyretry = true;
			run.notools = true;
			step(run, finish, fail);
			return;
		}

		run.notools = false;

		// The limit cut the answer: the user is told, because the last block may be unfinished
		if (!run.holdanswer && !tools.length && output.usage && predictlimit(run.model, run.conf) && output.usage.output >= predictlimit(run.model, run.conf) * 0.98)
			addpart(run, 'text', { text: '\n\n(The answer reached the limit of this model and was cut. Ask for one part at a time.)' }, true);

		run.messages.push(msg);

		if (!tools.length) {

			// The code of the answer is checked like the files that the tools write; the model corrects it once
			// Not for a command, and not for an answer that the limit cut: its last block is unfinished, and asking again only makes it longer
			var limit = predictlimit(run.model, run.conf);
			var cut = !!(output.usage && limit && output.usage.output >= limit * 0.98);
			var problems = (run.conf.selfcheck !== false && !run.selfchecked && !run.command && !cut && (run.conf.selfchecksmall === true || !smallmodel(run.model)) && MODS.instructions.istotaljs(run.root, run.conf)) ? MODS.conventions.answer(output.content || '', run.conf) : [];

			if (problems.length) {
				run.selfchecked = true;
				addpart(run, 'selfcheck', { problems: problems.length, rules: problems.map(p => p.rule).filter((value, index, list) => list.indexOf(value) === index) }, true);
				run.messages.push({ role: 'user', content: MODS.conventions.complaint(problems) });
				run.complaining = true;
				step(run, finish, fail);
				return;
			}

			if (run.holdanswer && output.content)
				addpart(run, 'text', { text: FUNC.scrub(output.content) }, true);

			// Check the final revision too; code that still fails must not become a file automatically.
			var remaining = run.holdanswer ? MODS.conventions.answer(output.content || '', run.conf) : [];
			if (cut)
				remaining.push({ rule: 'truncated', severity: 'error', message: 'The answer reached the output limit and may be incomplete.' });
			if (remaining.length)
				addpart(run, 'validation', { problems: remaining, blocking: remaining.some(function(problem) { return problem.severity === 'error'; }) }, true);

			// A small model that was asked to make files and answered with the code, each block with its path, did not call the tool. The files
			// that do not exist yet are written through the same tool (with its permission, its diff and its undo): the answer says it did.
			var made = (!cut && !remaining.length && run.make && run.mode === 'build' && smallmodel(run.model)) ? newfiles(run, output.content || '') : [];

			if (made.length) {
				var calls = made.map(file => ({ id: 'w' + UID(), name: 'write', arguments: { path: file.path, content: file.content } }));
				msg.tool_calls = calls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments) } }));
				runtools(run, calls, () => step(run, finish, fail));
				return;
			}

			finish('idle');
			return;
		}

		if (run.holdanswer && output.content)
			addpart(run, 'text', { text: FUNC.scrub(output.content) }, true);

		runtools(run, tools, function() {
			step(run, finish, fail);
		});
	});
}

// Opens a part, or appends to the open part of the same type
// Some models that think put their thoughts in the text and end them with </think> (the server does not split them, even when the thinking is
// switched off). For those models the start of the text waits until the tag shows up: what came before it is reasoning, what follows is the answer.
// Without the tag the text is released at the end of the answer, or when it is long enough to be an answer.
var THINKMAX = 40000;

function content(run, text, thinks) {

	if (!thinks || (run.think && run.think.done)) {
		delta(run, 'text', text);
		return;
	}

	var state = run.think || (run.think = { buffer: '', done: false });
	state.buffer += text;

	var end = state.buffer.indexOf('</think>');

	if (end !== -1) {
		var thought = state.buffer.substring(0, end).replace(/^\s*<think>\s*/, '').trim();
		var rest = state.buffer.substring(end + 8).replace(/^\s+/, '');
		state.done = true;
		state.buffer = '';
		thought && delta(run, 'reasoning', thought);
		closepart(run, 'reasoning');
		rest.trim() && delta(run, 'text', rest);
		return;
	}

	if (state.buffer.length > THINKMAX && !/^\s*<think>/.test(state.buffer))
		release(run);
}

function release(run) {
	if (run.think && !run.think.done) {
		var text = run.think.buffer;
		run.think.buffer = '';
		run.think.done = true;
		text && delta(run, 'text', text.replace(/^\s*<think>\s*/, ''));
	}
}

// The answer ended (or a step did): what is still waiting is the text
function endcontent(run) {
	release(run);
	run.think = null;
}

function delta(run, type, text) {

	if (type === 'text' && run.holdanswer) {
		run.draft += text;
		return;
	}

	var part = run.open[type];

	if (!part) {
		part = addpart(run, type, { text: '' }, false);
		run.open[type] = part;
	}

	part.data.text += text;
	FUNC.emit(run.sessionid, 'part.delta', { partid: part.id, text: text });
}

function addpart(run, type, data, closed) {

	var part = { id: UID(), messageid: run.message.id, sessionid: run.sessionid, type: type, data: data, dtcreated: NOW, seq: run.seq++ };

	FUNC.emit(run.sessionid, 'part.created', { part: part });

	if (closed)
		storepart(run, part);

	return part;
}

function storepart(run, part) {
	NOSQL('parts').insert(part).callback(NOOP);
	FUNC.emit(run.sessionid, 'part.closed', { partid: part.id });
}

function closepart(run, type) {
	if (run.open[type]) {
		storepart(run, run.open[type]);
		delete run.open[type];
	}
}

function closeparts(run) {
	for (var type in run.open) {
		storepart(run, run.open[type]);
		delete run.open[type];
	}
}

function toolstart(run, tool) {
	// The model started a call: show it as pending until the arguments are complete
	var part = addpart(run, 'tool', { call: tool.id, tool: tool.name, input: {}, status: 'pending' }, false);
	run.parts[tool.id] = part;
}

// The message of an action error, with the field when the input is invalid
exports.failure = failure;

function failure(err) {
	if (err && err.items && err.items.length)
		return err.items.map(item => (item.error && item.error !== '@') ? item.error : ('invalid or missing ' + (item.name || 'input'))).join('; ');
	return (err && err.message) || String(err);
}

// Agents asked for together in one answer work at the same time, a few at once: each one has its own context and only its final answer comes back
var MAXAGENTS = 3;

function runtools(run, tools, callback) {

	if (tools.length > 1 && tools.every(tool => tool.name === 'task')) {
		var groups = [];
		for (var i = 0; i < tools.length; i += MAXAGENTS)
			groups.push(tools.slice(i, i + MAXAGENTS));
		groups.wait(function(group, next) {
			var pending = group.length;
			group.forEach(tool => runtools(run, [tool], () => --pending === 0 && next()));
		}, callback);
		return;
	}

	tools.wait(function(tool, next) {

		if (run.aborted) {
			next();
			return;
		}

		var part = run.parts[tool.id];

		if (!part) {
			part = addpart(run, 'tool', { call: tool.id, tool: tool.name }, false);
			run.parts[tool.id] = part;
		}

		part.data.input = tool.arguments || {};

		function result(status, output, error) {
			output = FUNC.scrub(output);
			error = FUNC.plain(FUNC.scrub(error));
			run.denials = status === 'denied' ? run.denials + 1 : 0;
			part.data.status = status;
			part.data.output = output || '';
			part.data.error = error || '';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });
			storepart(run, part);
			run.messages.push({ role: 'tool', tool_call_id: tool.id, content: error ? ('Error: ' + error) : (output || '') });
			next();
		}

		var meta = TOOLS[tool.name];

		// A prompt of an MCP server (the server was already allowed to start). Its text is data from that server.
		if (!meta && tool.name === 'mcp_prompt' && run.mcp && Object.keys(run.mcp.prompts || {}).length) {
			part.data.status = 'running';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });
			MODS.mcpclient.prompt(run, part.data.input.name, part.data.input.arguments, function(err, text) {
				if (run.aborted)
					next();
				else if (err)
					result('error', '', typeof(err) === 'string' ? err : 'MCP error');
				else
					result('done', text);
			});
			return;
		}

		// A tool of an MCP server: it always asks, like the tools that change things
		if (!meta && run.mcp && run.mcp.tools[tool.name]) {

			MODS.permissions.check(run, 'mcp:' + tool.name, part.data.input, function(reply, reason) {

				if (reply !== 'allow') {
					result('denied', '', reason || 'Denied. Do not try again.');
					return;
				}

				part.data.status = 'running';
				FUNC.emit(run.sessionid, 'part.updated', { part: part });

				MODS.mcpclient.call(run, tool.name, part.data.input, function(err, text) {
					if (run.aborted)
						next();
					else if (err)
						result('error', '', typeof(err) === 'string' ? err : 'MCP error');
					else
						result('done', text);
				});
			});

			return;
		}

		if (!meta) {
			result('error', '', 'Unknown tool: ' + tool.name);
			return;
		}

		MODS.permissions.check(run, tool.name, part.data.input, function(reply, reason) {

			if (reply !== 'allow') {
				result('denied', '', reason || 'Denied. Do not try again.');
				return;
			}

			part.data.status = 'running';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });

			var user = { id: 'agent', sa: true, unattended: run.unattended, root: run.root, sessionid: run.sessionid, projectid: run.projectid, conf: run.conf, messageid: run.message.id, callid: tool.id };

			ACTION(meta.action, part.data.input).user(user).callback(function(err, response) {
				if (run.aborted)
					next();
				else if (err)
					result('error', '', failure(err));
				else
					result('done', typeof(response) === 'string' ? response : JSON.stringify(response));
			});
		});

	}, callback);
}

exports.abort = function(sessionid) {

	var run = MAIN.running[sessionid];
	if (!run)
		return false;

	run.aborted = true;
	MODS.subagent.abort(run);
	MODS.permissions.cancel(sessionid);

	if (run.ai && run.ai.options.abort)
		run.ai.options.abort();

	for (var child of (MAIN.children[sessionid] || []))
		child.kill();

	return true;
};
