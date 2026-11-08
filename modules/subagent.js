// A sub-agent: a nested run with its own context, a limited set of tools and its own step limit.
// Only its final answer goes back to the agent that started it. Its tool calls use the same permission check, so a question
// appears in the session of the user. What it does is shown as progress in the tool call that started it.

exports.id = 'subagent';

var MAXDENIALS = 3;

// The agent can allow or deny tools by itself (allow: and deny: in its file); deny wins. They only narrow what the project already decided
// for the questions: the boundary of the project and the Plan mode are checked first.
function rules(def) {
	var map = {};
	(def.allow || []).forEach(tool => map[tool] = 'allow');
	(def.deny || []).forEach(tool => map[tool] = 'deny');
	return map;
}

// callback(err, text)
exports.run = function(parent, name, prompt, callid, callback) {

	var def = MODS.agents.get(parent.root, name);

	if (!def) {
		callback('Unknown agent "{0}". Available: {1}'.format(name, MODS.agents.list(parent.root).map(a => a.name).join(', ')));
		return;
	}

	var part = parent.parts[callid];
	var log = [];

	var child = {
		sessionid: parent.sessionid,
		projectid: parent.projectid,
		root: parent.root,
		autoaccept: parent.autoaccept,
		unattended: parent.unattended,
		mode: parent.mode,
		rules: rules(def),
		model: parent.model,
		conf: parent.conf,
		aborted: false,
		steps: 0,
		denials: 0,
		messages: [{ role: 'user', content: prompt }],
		ai: null
	};

	parent.child = child;

	function progress(line) {
		log.push(line);
		if (part) {
			part.data.output = log.join('\n');
			FUNC.emit(parent.sessionid, 'part.updated', { part: part });
		}
	}

	function finish(err, text) {
		parent.child = null;
		callback(err, text);
	}

	var system = def.prompt + '\n\nWorking directory: {0}\nPlatform: {1}\n'.format(child.root, Total.Os.platform());
	if (MODS.instructions.istotaljs(child.root, child.conf))
		system += '\n' + MODS.instructions.primer() + '\n';

	var instructions = MODS.instructions.text(child.root);

	if (instructions)
		system += '\nInstructions of this project (AGENTS.md):\n' + instructions + '\n';

	function loop() {

		if (child.aborted) {
			finish('aborted');
			return;
		}

		if (child.denials >= MAXDENIALS) {
			finish(null, 'Stopped: the last {0} actions were rejected.'.format(MAXDENIALS));
			return;
		}

		if (child.steps >= def.maxsteps) {
			finish(null, 'Stopped at the step limit of this agent ({0}).'.format(def.maxsteps));
			return;
		}

		child.steps++;
		progress('step ' + child.steps);

		var meta = (MAIN.modelmeta && MAIN.modelmeta[child.model]) || {};
		var ai = AIMODEL(child.model);
		ai.conf = child.conf;
		ai.payload.messages = [{ role: 'system', content: system }].concat(child.messages);
		ai.payload.tools = meta.tools === false ? [] : MODS.agent.definitions(def.tools, child.mode);
		child.ai = ai;

		ai.callback(function(err, output) {

			child.ai = null;

			if (child.aborted) {
				finish('aborted');
				return;
			}

			if (err) {
				finish(typeof(err) === 'string' ? err : (err.message || 'Model error'));
				return;
			}

			var tools = output.tools || [];
			var message = { role: 'assistant', content: output.content || null };

			if (tools.length)
				message.tool_calls = tools.map(t => MODS.agent.withsignature({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) } }, t.thoughtSignature));

			child.messages.push(message);

			if (!tools.length) {
				finish(null, FUNC.scrub(output.content || '(the agent gave no answer)'));
				return;
			}

			tools.wait(function(tool, next) {

				if (child.aborted) {
					next();
					return;
				}

				function result(text, status) {
					child.denials = status === 'denied' ? child.denials + 1 : 0;
					progress('[{0}] {1}'.format(tool.name, status));
					child.messages.push({ role: 'tool', tool_call_id: tool.id, content: FUNC.plain(FUNC.scrub(text)) });
					next();
				}

				var meta = MODS.agent.tools[tool.name];

				// Only the tools of the definition exist for this agent
				if (!meta || def.tools.indexOf(tool.name) === -1) {
					result('Error: unknown tool ' + tool.name, 'error');
					return;
				}

				MODS.permissions.check(child, tool.name, tool.arguments || {}, function(reply, reason) {

					if (reply !== 'allow') {
						result('Error: ' + (reason || 'Denied'), 'denied');
						return;
					}

					var user = { id: 'agent', sa: true, unattended: child.unattended, root: child.root, sessionid: child.sessionid, projectid: child.projectid, conf: child.conf, messageid: parent.message.id, callid: tool.id };

					ACTION(meta.action, tool.arguments || {}).user(user).callback(function(err, response) {
						if (child.aborted)
							next();
						else if (err)
							result('Error: ' + MODS.agent.failure(err), 'error');
						else
							result(typeof(response) === 'string' ? response : JSON.stringify(response), 'done');
					});
				});

			}, loop);
		});
	}

	progress('agent ' + def.name);
	loop();
};

// Stops the nested run of a session
exports.abort = function(run) {
	if (run.child) {
		run.child.aborted = true;
		if (run.child.ai && run.child.ai.options.abort)
			run.child.ai.options.abort();
	}
};
