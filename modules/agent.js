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
	if (MODS.instructions.istotaljs(run.root))
		text += '\n' + MODS.instructions.primer() + '\n';

	var instructions = MODS.instructions.text(run.root);
	if (instructions)
		text += '\nInstructions of this project (AGENTS.md):\n' + instructions + '\n';

	// The pages of Forge that the search found for this request
	if (run.knowledge)
		text += '\n' + run.knowledge + '\n';

	var agents = MODS.agents.list(run.root);
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
var REMINDER = '\n\n(Total.js 5, in its style: indent with TABS, ES5 (var and function, no =>, const, let or template literals), texts for people marked for translation as the recipes show, Total.Fs and not require(\'fs\'). Follow the recipes and the pages above; when they do not have what you need, say so instead of inventing a function. Answer with the code in plain text: use tools only to read or change files of the project.)';
var REMINDERUI = '\n\n(Total.js 5 and jComponent 20, the interface library of Total.js: not Java, not React or another framework. Style: indent with TABS, ES5 (var and function, no =>, const, let or template literals), texts for people marked for translation as the recipes show. Follow the recipes and the pages above; when they do not have what you need, say so instead of inventing a function. Answer with the code in plain text: use tools only to read or change files of the project.)';
var UIWORDS = /jcomponent|ui-component|ui-plugin|\bcomponent|\bplugin\b|\bform\b|\bbutton|\bscreen|\bpage\b|\bhtml\b|\btable\b|\binterface|\bfrontend|\bpantalla|formulario|bot[oó]n|componente|interfaz|tangular|\bui\b/i;

function reminderof(content) {
	var text = Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join(' ') : (content || '');
	return UIWORDS.test(text) ? REMINDERUI : REMINDER;
}

// The last message, when it is the one of the user, ends with the reminder
function withreminder(messages) {

	var last = messages[messages.length - 1];

	if (!last || last.role !== 'user')
		return messages;

	var copy = messages.slice();
	var reminder = reminderof(last.content);

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
	var limit = window ? Math.floor(window * 0.8) : CONF.contextlimit;

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

	var run = {
		sessionid: session.id,
		projectid: project.id,
		root: project.path,
		autoaccept: !!session.autoaccept,
		unattended: !!session.unattended,
		mode: session.mode === 'plan' ? 'plan' : 'build',
		aborted: false,
		steps: 0,
		max: session.maxsteps || CONF.maxsteps,
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
			var lastknowledge = parts.filter(p => p.type === 'knowledge' && p.data && p.data.recipes).pop();
			run.shown = lastknowledge ? lastknowledge.data.recipes : [];

			// A small local model copies the code of its own earlier answers, whatever is asked next
			if (CONF.lighthistory !== false && /^ollama:/.test(run.model || ''))
				run.messages = lighthistory(run.messages);

			// The MCP servers of the project that the user allows; their tools join the ones of Totem
			MODS.mcpclient.connect(run, function() {

				// The pages of Forge that match the request go into the prompt, so that even a small model starts from the documentation
				var last = run.messages[run.messages.length - 1];
				MODS.knowledge.prefetch(run, last && last.role === 'user' ? last.content : '', function(pages) {
					if (pages.length)
						addpart(run, 'knowledge', { pages: pages, recipes: run.recipeids || [] }, true);
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
	ai.payload.messages = [{ role: 'system', content: system(run) }].concat(run.messages);

	// A model that is known not to support tools only chats: the request without tools is better than an error
	var meta = (MAIN.modelmeta && MAIN.modelmeta[run.model]) || {};

	// A small model follows the end of the conversation better than the beginning: the prompt of the user, in a Total.js project, carries a
	// short reminder in the request (it is not stored and the user does not see it)
	if (MODS.instructions.istotaljs(run.root))
		ai.payload.messages = withreminder(ai.payload.messages);

	if (meta.vision === false)
		ai.payload.messages = withoutimages(ai.payload.messages);

	ai.payload.tools = (meta.tools === false || run.notools) ? [] : exports.definitions(null, run.mode).concat((run.mcp && run.mcp.defs) || []);
	ai.payload.reasoning = run.reasoning;
	run.ai = ai;

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
			if (retryable(message) && run.attempts < CONF.retries) {
				run.attempts++;
				run.steps--;
				closeparts(run);
				FUNC.emit(run.sessionid, 'error', { message: message, retry: true });
				setTimeout(() => step(run, finish, fail), CONF.retrybase * Math.pow(2, run.attempts - 1));
				return;
			}

			fail(message);
			return;
		}

		run.attempts = 0;
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
		run.messages.push(msg);

		if (!tools.length) {

			// The code of the answer is checked like the files that the tools write; the model corrects it once
			// Not for a command, and not for an answer that the limit cut: its last block is unfinished, and asking again only makes it longer
			var cut = !!(output.usage && CONF.ollamapredict && output.usage.output >= CONF.ollamapredict * 0.98);
			var problems = (CONF.selfcheck !== false && !run.selfchecked && !run.command && !cut && MODS.instructions.istotaljs(run.root)) ? MODS.conventions.answer(output.content || '') : [];

			if (problems.length) {
				run.selfchecked = true;
				addpart(run, 'selfcheck', { problems: problems.length, rules: problems.map(p => p.rule).filter((value, index, list) => list.indexOf(value) === index) }, true);
				run.messages.push({ role: 'user', content: MODS.conventions.complaint(problems) });
				step(run, finish, fail);
				return;
			}

			finish('idle');
			return;
		}

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

function runtools(run, tools, callback) {

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

			var user = { id: 'agent', sa: true, unattended: run.unattended, root: run.root, sessionid: run.sessionid, projectid: run.projectid, messageid: run.message.id, callid: tool.id };

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
