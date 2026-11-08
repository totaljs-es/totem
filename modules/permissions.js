// Permission rules: tool + pattern -> allow | ask | deny. The project rules come first, then the defaults.

exports.id = 'permissions';

var READONLY = { read: 1, glob: 1, grep: 1, todo: 1, ask: 1, skill: 1, task: 1, job: 1 };
var SECRETS = /(^|\/)\.env(\.[^\/]*)?$/;
var SECRETSOK = /\.(example|sample|template)$/;
var CHAINED = /[;&|<>$`()\n\\]/;
var READONLY_COMMANDS = /^(pwd|ls(?: -[aAlh1]+)?|git status(?: --short| --porcelain)?)$/;

// Subject of a tool call that a rule pattern is compared with
function subject(tool, input) {
	if (tool === 'bash')
		return (input.command || '').trim();
	return input.path || input.pattern || input.url || input.command || '';
}

exports.subject = subject;

exports.issecret = function(path) {
	return SECRETS.test(path) && !SECRETSOK.test(path);
};

// callback(reply) where reply is 'allow' or 'deny'
exports.check = function(run, tool, input, callback) {

	var text = subject(tool, input);

	// A path outside the project is refused before any rule
	if (tool !== 'bash' && input.path && !FUNC.resolve(run.root, input.path)) {
		callback('deny', 'The path is outside the project. Use a path inside it.');
		return;
	}

	// Plan mode only reads: nothing that changes files or runs a command, whatever the rules say
	if (run.mode === 'plan' && (tool === 'write' || tool === 'edit' || tool === 'patch' || tool === 'bash' || tool === 'mcp-start' || tool.indexOf('mcp:') === 0 || (tool === 'job' && input.stop))) {
		callback('deny', 'This session is in Plan mode: it cannot change files or run commands. Describe the change in your plan instead.');
		return;
	}

	// The rules of the agent that runs (a sub-agent): deny always, allow only for what would otherwise ask
	if (run.rules && run.rules[tool] === 'deny') {
		callback('deny', 'This agent is not allowed to use ' + tool + '. Do not try again; say what you needed.');
		return;
	}

	// The rules of the project and the global ones (an empty project)
	NOSQL('permissions').find().in('projectid', [run.projectid, '']).callback(function(err, rules) {

		var found = null;
		var best = -1;

		for (var rule of (rules || [])) {
			if (rule.tool !== tool && rule.tool !== '*')
				continue;
			if (rule.pattern && !FUNC.glob(rule.pattern).test(text))
				continue;
			var score = (rule.tool === tool ? 2 : 0) + (rule.pattern ? 1 : 0);
			if (score > best || (score === best && rule.action === 'deny')) {
				best = score;
				found = rule.action;
			}
		}

		if (!found) {
			// Files with secrets are read only when the user says so (examples are fine)
			if (SECRETS.test(text) && !SECRETSOK.test(text) && (tool === 'read' || tool === 'edit' || tool === 'write'))
				found = 'ask';
			else if (READONLY[tool] || (tool === 'bash' && READONLY_COMMANDS.test(text) && !CHAINED.test(text)))
				found = 'allow';
			else if ((tool === 'write' || tool === 'edit' || tool === 'patch') && run.autoaccept)
				found = 'allow';
			else if (run.rules && run.rules[tool] === 'allow' && !(tool === 'bash' && CHAINED.test(text)))
				found = 'allow';
			else
				found = 'ask';
		}

		if (found !== 'ask') {
			callback(found, found === 'deny' ? 'Denied by a permission rule. Do not try again; tell the user what you wanted to do.' : null);
			return;
		}

		// A scheduled run has nobody to ask: what needs an answer is refused
		if (run.unattended) {
			callback('deny', 'This run is unattended (a scheduled prompt): nobody can approve this action. Do not try again; say in your answer what you wanted to do.');
			return;
		}

		// Ask the user and wait for Permissions|reply
		var id = UID();
		var event = { type: 'permission.ask', data: { id: id, tool: tool, input: input, patterns: [text] } };
		MAIN.asks[id] = { sessionid: run.sessionid, tool: tool, text: text, callback: callback, projectid: run.projectid, event: event };
		FUNC.emit(run.sessionid, event.type, event.data);
	});
};

// The user answered: reply is 'once', 'always' or 'reject'
exports.reply = function(id, reply) {

	var ask = MAIN.asks[id];
	if (!ask || ask.kind === 'question')
		return false;

	delete MAIN.asks[id];

	// Starting a server that Totem brings (Forge) is allowed once for every project; the rest is allowed for the project
	if (reply === 'always')
		NOSQL('permissions').insert({ id: UID(), projectid: ask.tool === 'mcp-start' && /^forge: /.test(ask.text) ? '' : ask.projectid, tool: ask.tool, pattern: ask.text, action: 'allow', dtcreated: NOW });

	FUNC.emit(ask.sessionid, 'permission.replied', { id: id, reply: reply });
	ask.callback(reply === 'reject' ? 'deny' : 'allow', reply === 'reject' ? 'The user rejected this action. Do not try it again; explain what you wanted to change and ask how to proceed.' : null);
	return true;
};

// The questions that wait for an answer in a session, as events: a client that opens the session later has to see them
exports.pending = function(sessionid) {
	var list = [];
	for (var id in MAIN.asks) {
		var ask = MAIN.asks[id];
		if (ask.sessionid === sessionid && ask.event)
			list.push(ask.event);
	}
	return list;
};

// The user answered a question of the ask tool
exports.answer = function(id, answer) {

	var ask = MAIN.asks[id];
	if (!ask || ask.kind !== 'question')
		return false;

	delete MAIN.asks[id];
	FUNC.emit(ask.sessionid, 'question.replied', { id: id });
	ask.callback(answer);
	return true;
};

// Rejects every pending permission question and closes every question of a session (abort or removal)
exports.cancel = function(sessionid) {
	for (var id in MAIN.asks) {
		var ask = MAIN.asks[id];
		if (ask.sessionid !== sessionid)
			continue;
		if (ask.kind === 'question')
			exports.answer(id, '(no answer: the run was stopped)');
		else
			exports.reply(id, 'reject');
	}
};
