NEWACTION('Sessions|list', {
	name: 'List sessions of a project',
	summary: 'Lists the sessions of a project, newest first.',
	mcp: true,
	query: '*projectid',
	action: async function($) {
		var items = await NOSQL('sessions').find().where('projectid', $.query.projectid).sort('dtupdated_desc').promise($);

		// Names that an old bug wrote ("[object Object]") become the title of the first prompt, or the default name
		for (var item of items) {
			if (!/^\[object Object\]/.test(item.name || ''))
				continue;
			var title = '';
			var first = await NOSQL('messages').find().where('sessionid', item.id).where('role', 'user').sort('dtcreated').take(1).promise($);
			if (first.length) {
				var part = await NOSQL('parts').find().where('messageid', first[0].id).where('type', 'text').take(1).promise($);
				title = part.length ? FUNC.title(part[0].data.text || '') : '';
			}
			item.name = (title || 'New session') + (/\(fork\)$/.test(item.name) ? ' (fork)' : '');
			item.named = false;
			await NOSQL('sessions').modify({ name: item.name, named: false }).where('id', item.id).promise($);
		}

		$.callback(items);
	}
});

NEWACTION('Sessions|create', {
	name: 'Create a session',
	summary: 'Creates a session in a project. The model is one of the models that Totem lists (provider:model).',
	mcp: true,
	input: '*projectid:String, name:String, model:String, autoaccept:Boolean, reasoning:String, worktree:Boolean',
	action: async function($, model) {
		var project = await NOSQL('projects').read().where('id', model.projectid).error(404).promise($);
		// A name given by the user stays; without one the session is named after its first prompt
		var name = (typeof(($.body || model).name) === 'string' ? model.name : '').trim().substring(0, 80);
		var item = { id: UID(), projectid: model.projectid, name: name || 'New session', named: !!name, model: model.model || '', status: 'idle', autoaccept: !!model.autoaccept, reasoning: model.reasoning || '', maxsteps: CONF.maxsteps, dtcreated: NOW, dtupdated: NOW };

		// A session in its own git worktree: a second checkout on its own branch
		if (model.worktree) {
			var made = await new Promise(resolve => MODS.worktrees.create(project.path, item.id, (err, worktree) => resolve({ err: err, worktree: worktree })));
			if (made.err) {
				$.invalid(made.err);
				return;
			}
			item.worktree = made.worktree;
		}

		await NOSQL('sessions').insert(item).promise($);
		$.callback(item);
	}
});

NEWACTION('Sessions|update', {
	name: 'Rename a session',
	params: '*id',
	input: '*name:String',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var name = model.name.trim().substring(0, 80);

		if (!name) {
			$.invalid('@(The name is empty)');
			return;
		}

		session.name = name;
		session.named = true;
		await NOSQL('sessions').modify({ name: name, named: true }).where('id', session.id).promise($);
		FUNC.emit(session.id, 'session.updated', { session: session });
		$.success();
	}
});

NEWACTION('Sessions|read', {
	name: 'Read a session',
	summary: 'Reads a session: its status, model and mode.',
	mcp: true,
	params: '*id',
	action: async function($) {
		var item = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		item.redo = await new Promise(resolve => MODS.snapshots.canredo(item.id, resolve));
		$.callback(item);
	}
});

NEWACTION('Sessions|remove', {
	name: 'Remove a session',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		var session = await NOSQL('sessions').read().where('id', id).promise($);
		MODS.agent.abort(id);
		MODS.jobs.clear(id);
		MODS.terminal.clear(id);

		// The worktree goes with the session only when nothing would be lost: no uncommitted files, no commits that were not merged and no other
		// session working in it. Otherwise it stays, with its branch, until the user discards it.
		if (session && session.worktree && Total.Fs.existsSync(session.worktree.path)) {
			var project = await NOSQL('projects').read().where('id', session.projectid).promise($);
			var others = await NOSQL('sessions').find().where('projectid', session.projectid).promise($);
			var shared = others.some(other => other.id !== id && other.worktree && other.worktree.path === session.worktree.path);
			if (project && !shared) {
				var state = await new Promise(resolve => MODS.worktrees.state(project.path, session.worktree, resolve));
				if (!state.changes && !state.ahead)
					await new Promise(resolve => MODS.worktrees.remove(project.path, session.worktree, resolve));
			}
		}

		await new Promise(resolve => MODS.snapshots.clear(id, resolve));
		await new Promise(resolve => MODS.attachments.clear(id, resolve));
		await NOSQL('todos').remove().where('sessionid', id).promise($);
		await NOSQL('parts').remove().where('sessionid', id).promise($);
		await NOSQL('messages').remove().where('sessionid', id).promise($);
		await NOSQL('sessions').remove().where('id', id).promise($);
		$.success();
	}
});

NEWACTION('Sessions|messages', {
	name: 'Messages of a session with their parts',
	summary: 'Reads the messages of a session with their parts (text, reasoning, tool calls with their output).',
	mcp: true,
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		var messages = await NOSQL('messages').find().where('sessionid', id).sort('dtcreated').promise($);
		var parts = await NOSQL('parts').find().where('sessionid', id).sort('dtcreated').promise($);
		var byid = {};
		for (var part of parts) {
			if (!byid[part.messageid])
				byid[part.messageid] = [];
			byid[part.messageid].push(part);
		}
		for (var message of messages)
			message.parts = (byid[message.id] || []).sort((a, b) => a.seq - b.seq);
		$.callback(messages);
	}
});

NEWACTION('Sessions|prompt', {
	name: 'Send a prompt to the agent',
	summary: 'Sends a prompt to the agent of a session and returns at once; read the session to follow it. A change of files or a command asks the person at the Totem screen unless the session auto-accepts edits. The session can be in mode plan (reads only) or build.',
	mcp: true,
	params: '*id',
	input: '*text:String, model:String, autoaccept:Boolean, reasoning:String, mode:String, attachments:[Object]',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);

		if (MAIN.running[session.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);

		if (session.worktree && !Total.Fs.existsSync(session.worktree.path)) {
			$.invalid('@(The worktree of this session was discarded: start a new session)');
			return;
		}

		if (model.model)
			session.model = model.model;

		// A Boolean input is false when it is missing: only an explicit value changes the session
		if ($.body && $.body.autoaccept !== undefined)
			session.autoaccept = !!model.autoaccept;

		if (($.body || model).mode !== undefined)
			session.mode = model.mode === 'plan' ? 'plan' : 'build';

		if ($.body && $.body.reasoning !== undefined)
			session.reasoning = model.reasoning || '';

		if (!session.model || !F.aimodels[session.model]) {
			$.invalid('@(Choose a model first)');
			return;
		}

		await new Promise(resolve => MODS.snapshots.dropredo(session.id, resolve));
		await NOSQL('sessions').modify({ model: session.model, autoaccept: session.autoaccept, mode: session.mode || 'build', reasoning: session.reasoning || '' }).where('id', session.id).promise($);

		// The files of the prompt: images and text files
		var files = await new Promise(resolve => MODS.attachments.save(session.id, model.attachments, (err, saved) => resolve(err ? { error: err } : saved)));

		if (files.error) {
			$.invalid(files.error);
			return;
		}

		// A command of the project: /name arguments. The conversation shows what the user typed, the model gets the expanded text.
		var command = MODS.commands.expand(project.path, model.text);
		// The first prompt of a session that has no name of the user gives it one
		if (!session.named && (!session.name || session.name === 'New session')) {
			var first = await NOSQL('messages').find().where('sessionid', session.id).take(1).promise($);
			if (!first.length) {
				var title = FUNC.title(model.text);
				if (title) {
					session.name = title;
					await NOSQL('sessions').modify({ name: title }).where('id', session.id).promise($);
					FUNC.emit(session.id, 'session.updated', { session: session });
				}
			}
		}

		var message = { id: UID(), sessionid: session.id, role: 'user', dtcreated: FUNC.stamp() };
		var part = { id: UID(), messageid: message.id, sessionid: session.id, type: 'text', data: { text: model.text }, dtcreated: NOW, seq: 0 };

		if (command)
			part.data.expanded = command.text;

		await NOSQL('messages').insert(message).promise($);
		await NOSQL('parts').insert(part).promise($);

		FUNC.emit(session.id, 'message.created', { message: message });
		FUNC.emit(session.id, 'part.created', { part: part });

		// One part per file, after the text
		for (var i = 0; i < files.length; i++) {
			var filepart = { id: UID(), messageid: message.id, sessionid: session.id, type: 'file', data: files[i], dtcreated: NOW, seq: i + 1 };
			await NOSQL('parts').insert(filepart).promise($);
			FUNC.emit(session.id, 'part.created', { part: filepart });
		}

		MODS.agent.run(session, project, message);
		$.callback({ messageid: message.id });
	}
});

NEWACTION('Sessions|abort', {
	name: 'Stop the agent',
	summary: 'Stops the agent of a session.',
	mcp: true,
	params: '*id',
	action: function($) {
		MODS.agent.abort($.params.id);
		$.success();
	}
});


NEWACTION('Sessions|diff', {
	name: 'Files changed by the agent in a session',
	summary: 'Lists the files that the agent changed in a session, each with its patch.',
	mcp: true,
	params: '*id',
	action: async function($) {
		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);
		MODS.snapshots.files(session, project, (err, files) => $.callback(files));
	}
});

NEWACTION('Sessions|undo', {
	name: 'Undo the changes of a message and the later ones',
	params: '*id',
	input: '*messageid:String',
	action: async function($, model) {

		if (MAIN.running[$.params.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);

		MODS.snapshots.undo(session, project, model.messageid, function(err, restored) {
			if (err)
				$.invalid(err);
			else
				$.callback(restored);
		});
	}
});

// A code block of an answer that starts with its path as a comment (// schemas/system.js) can be saved by the user with one click. A small model
// does not always call the write tool: this is the same write, with its snapshot (so it can be undone) and the same protections, and the click of the
// user is the permission.
NEWACTION('Sessions|saveblock', {
	name: 'Save a code block of an answer as a file of the project',
	params: '*id',
	input: '*messageid:String, *path:String, *content:Text, replace:Boolean',
	action: async function($, model) {

		if (MAIN.running[$.params.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);

		var relative = model.path.replace(/\\/g, '/').replace(/^\.\//, '');
		var path = FUNC.resolve(project.path, relative);

		if (!path || !relative || /(^|\/)\.git(\/|$)/.test(relative) || (/(^|\/)\.env(\.[^\/]*)?$/.test(relative) && !/\.(example|sample|template)$/.test(relative))) {
			$.invalid('@(The path is outside the project or protected)');
			return;
		}

		// A file that exists is replaced only when the user says so (the old content stays in the undo of the message)
		if (!model.replace && Total.Fs.existsSync(path)) {
			$.callback({ exists: true, path: relative });
			return;
		}

		MODS.snapshots.before({ sessionid: session.id, messageid: model.messageid, root: project.path }, relative, path);
		Total.Fs.mkdirSync(Total.Path.dirname(path), { recursive: true });
		Total.Fs.writeFileSync(path, model.content, 'utf8');
		MODS.formatter.run(project.path, path);
		$.callback({ path: relative, lines: model.content.split('\n').length });
	}
});

NEWACTION('Sessions|redo', {
	name: 'Redo the last undo',
	params: '*id',
	action: async function($) {

		if (MAIN.running[$.params.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);

		MODS.snapshots.redo(session, project, function(err, restored) {
			if (err)
				$.invalid(err);
			else
				$.callback(restored);
		});
	}
});

NEWACTION('Sessions|fork', {
	name: 'Copy a session up to a message into a new session',
	params: '*id',
	input: 'messageid:String',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var messages = await NOSQL('messages').find().where('sessionid', session.id).sort('dtcreated').promise($);
		var parts = await NOSQL('parts').find().where('sessionid', session.id).sort('dtcreated').promise($);

		// Up to and including the message that was chosen (all of them without one)
		if (model.messageid) {
			var index = messages.findIndex(m => m.id === model.messageid);
			if (index === -1) {
				$.invalid('@(Message not found)');
				return;
			}
			messages = messages.slice(0, index + 1);
		}

		var copy = Object.assign({}, session, { id: UID(), name: ((session.name || 'New session') + ' (fork)').substring(0, 80), named: true, status: 'idle', dtcreated: NOW, dtupdated: NOW });
		delete copy.redo;
		await NOSQL('sessions').insert(copy).promise($);

		var files = await new Promise(resolve => MODS.attachments.copy(session.id, copy.id, resolve));
		var ids = {};

		for (var message of messages) {
			ids[message.id] = UID();
			await NOSQL('messages').insert(Object.assign({}, message, { id: ids[message.id], sessionid: copy.id })).promise($);
		}

		for (var part of parts) {

			if (!ids[part.messageid])
				continue;

			var data = Object.assign({}, part.data);

			if (part.type === 'file' && files[data.id])
				data.id = files[data.id];

			await NOSQL('parts').insert(Object.assign({}, part, { id: UID(), messageid: ids[part.messageid], sessionid: copy.id, data: data })).promise($);
		}

		$.callback(copy);
	}
});

NEWACTION('Sessions|todos', {
	name: 'Task list of a session',
	params: '*id',
	action: async function($) {
		var items = await NOSQL('todos').find().where('sessionid', $.params.id).sort('index').promise($);
		$.callback(items);
	}
});

NEWACTION('Sessions|jobs', {
	name: 'Background commands of a session',
	summary: 'The commands that the agent started in the background in this session, with their state and the end of their output.',
	params: '*id',
	action: function($) {
		$.callback(MODS.jobs.list($.params.id).map(job => ({ id: job.id, command: job.command, status: job.status, output: MODS.jobs.tail(job), dtcreated: job.dtcreated })));
	}
});

NEWACTION('Sessions|jobstop', {
	name: 'Stop a background command',
	params: '*id',
	input: '*job:String',
	action: function($, model) {

		var job = MODS.jobs.get($.params.id, model.job);

		if (!job) {
			$.invalid('@(Job not found)');
			return;
		}

		MODS.jobs.stop(job);
		$.success();
	}
});

// The interactive terminal: a shell of the user in the project folder. The model has no tool for it.
NEWACTION('Sessions|terminal', {
	name: 'Open the terminal of a session',
	summary: 'Reattaches to the interactive terminal of the session and returns what it printed so far. With start it opens one when none is running.',
	params: '*id',
	input: 'start:Boolean, columns:Number, rows:Number',
	action: async function($, model) {

		var item = MODS.terminal.get($.params.id);

		// Without start it only reattaches to a terminal that exists (the page was reloaded)
		if (!model.start && !item) {
			$.callback({ status: 'none', output: '' });
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		project = FUNC.sessionproject(session, project);
		item = (model.start || (item && item.status === 'running')) ? MODS.terminal.open({ sessionid: session.id, root: project.path }, model.columns, model.rows) : item;
		$.callback({ status: item.status, output: item.output });
	}
});

NEWACTION('Sessions|terminalinput', {
	name: 'Type into the terminal',
	summary: 'The keys are sent as base64 because a schema trims text, and a terminal needs its Enter, Tab and control keys untouched.',
	params: '*id',
	input: '*data:String',
	action: function($, model) {

		if (!MODS.terminal.write($.params.id, Buffer.from(model.data, 'base64').toString('utf8'))) {
			$.invalid('@(The terminal is not running)');
			return;
		}

		$.success();
	}
});

NEWACTION('Sessions|terminalresize', {
	name: 'Resize the terminal',
	params: '*id',
	input: '*columns:Number, *rows:Number',
	action: function($, model) {
		MODS.terminal.resize($.params.id, model.columns, model.rows);
		$.success();
	}
});

NEWACTION('Sessions|terminalstop', {
	name: 'Close the terminal',
	params: '*id',
	action: function($) {
		MODS.terminal.stop($.params.id);
		$.success();
	}
});

// The git state of what the session works on: its worktree when it has one, the project otherwise
NEWACTION('Sessions|git', {
	name: 'Git state of a session',
	summary: 'The branch and the changed files of the folder where the session works, and the state of its worktree when it has one.',
	params: '*id',
	action: async function($) {
		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		var state = await new Promise(resolve => MODS.git.status(FUNC.sessionproject(session, project).path, resolve));
		if (session.worktree)
			state.worktree = await new Promise(resolve => MODS.worktrees.state(project.path, session.worktree, resolve));
		$.callback(state);
	}
});

NEWACTION('Sessions|worktreemerge', {
	name: 'Merge the worktree of a session into the project',
	summary: 'Commits what the session left in its worktree and merges its branch into the branch that is checked out in the project. A conflict is undone.',
	params: '*id',
	action: async function($) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);

		if (!session.worktree || !Total.Fs.existsSync(session.worktree.path)) {
			$.invalid('@(This session has no worktree)');
			return;
		}

		if (MAIN.running[session.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var result = await new Promise(resolve => MODS.worktrees.merge(project.path, session.worktree, session.name || 'session', (err, output) => resolve({ err: err, output: output })));

		if (result.err) {
			$.invalid(result.err);
			return;
		}

		$.callback({ merged: true, output: result.output });
	}
});

NEWACTION('Sessions|worktreediscard', {
	name: 'Discard the worktree of a session',
	summary: 'Removes the worktree and its branch. What the session did there and did not merge is lost.',
	params: '*id',
	action: async function($) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);

		if (!session.worktree) {
			$.invalid('@(This session has no worktree)');
			return;
		}

		MODS.agent.abort(session.id);
		MODS.terminal.clear(session.id);
		MODS.jobs.clear(session.id);

		var err = await new Promise(resolve => MODS.worktrees.remove(project.path, session.worktree, resolve));

		if (err) {
			$.invalid(err);
			return;
		}

		$.success();
	}
});
