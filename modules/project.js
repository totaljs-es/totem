// A project in small tasks. A model of a few billion parameters cannot hold a whole application in its head, so it does not have to:
//
//   /project <request>   the model fills a short card (the plugins of the application and the fields of each one); or the card comes
//                        written, from a person or from a larger model, and no model is asked
//   /build               Totem makes the tasks from the card and walks them one by one. Each task is one file, in a run with no history:
//                        the card of its plugin, the names the rest of the application uses and a file that works, as the example
//
// The plan is kept in the project (.totem/project.json for Totem and .totem/project.md for people), so a build that stops goes on
// where it was. The files that are the same in every application (the shell, the server part of a plugin) are written by Totem, not
// by the model. The names of the actions and of the endpoints come from the card, so every file of a plugin agrees with the others.

exports.id = 'project';

var TYPES = ['String', 'Number', 'Boolean', 'Date', 'Email', 'Phone', 'URL'];
var RESERVED = ['id', 'dtcreated', 'dtupdated'];
var MAXPLUGINS = 8;
var MAXFIELDS = 16;

// The names of Total Icons (private/project/icons.txt, from the style sheet of the jComponent library): an icon that is not there draws nothing
var ICONS = null;

function isicon(name) {
	if (!ICONS) {
		ICONS = {};
		try {
			Total.Fs.readFileSync(PATH.private('project/icons.txt'), 'utf8').split('\n').forEach(line => line.trim() && (ICONS[line.trim()] = 1));
		} catch (e) {}
	}
	return ICONS[name] === 1;
}

exports.isicon = isicon;

function capitalize(text) {
	return text.charAt(0).toUpperCase() + text.substring(1);
}

function singular(name) {
	if (/ies$/.test(name))
		return name.substring(0, name.length - 3) + 'y';
	if (/[^s]s$/.test(name))
		return name.substring(0, name.length - 1);
	return name;
}

// The card: lines "KEY: value". APP once, then PLUGIN and the lines of that plugin (TITLE, ICON, TABLE, FIELDS).
// { app, plugins: [{ id, title, icon, table, collection, fields: [{ name, type, required }] }] } and the problems found: { card, errors }
exports.parse = function(text, fallback) {

	var card = { app: '', plugins: [] };
	var errors = [];
	var current = null;

	(text || '').split('\n').forEach(function(line) {

		var match = line.replace(/^[\s>`-]+/, '').replace(/^\*+\s*(?=[A-Za-z]+\s*:)/, '').replace(/`+\s*$/, '').match(/^(APP|PLUGIN|TITLE|ICON|TABLE|FIELDS)\s*:\s*(.*)$/i);

		if (!match)
			return;

		var key = match[1].toUpperCase();
		var value = match[2].trim().replace(/^[`'"]+|[`'"]+$/g, '');

		if (key === 'APP') {
			card.app = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
			return;
		}

		if (key === 'PLUGIN') {
			current = { id: value.toLowerCase().replace(/[^a-z0-9]+/g, ''), title: '', icon: '', table: '', fields: [] };
			card.plugins.push(current);
			return;
		}

		if (!current)
			return;

		if (key === 'TITLE')
			current.title = value.substring(0, 40);
		else if (key === 'ICON')
			current.icon = value;
		else if (key === 'TABLE')
			current.table = value.toLowerCase().replace(/[^a-z0-9_]+/g, '');
		else if (key === 'FIELDS') {
			value.split(',').forEach(function(item) {
				var field = item.trim().match(/^(\*?)([A-Za-z][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z]+))?\s*(\*?)$/);
				if (!field) {
					item.trim() && errors.push('The field "' + item.trim() + '" of the plugin ' + current.id + ' is not "name:Type".');
					return;
				}
				var name = field[2].toLowerCase();
				// The id and the dates of a row are filled by the action: they are not fields of the form
				if (RESERVED.indexOf(name) !== -1)
					return;
				var type = TYPES.find(t => t.toLowerCase() === (field[3] || 'String').toLowerCase());
				if (!type) {
					errors.push('The type of the field ' + field[2] + ' of the plugin ' + current.id + ' is "' + field[3] + '": use one of ' + TYPES.join(', ') + '.');
					return;
				}
				if (!current.fields.some(f => f.name === name))
					current.fields.push({ name: name, type: type, required: !!(field[1] || field[4]) });
			});
		}
	});

	if (!card.app)
		card.app = (fallback || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

	if (!card.plugins.length)
		errors.push('There is no plugin: write at least one line "PLUGIN: name" with its "FIELDS:".');

	if (card.plugins.length > MAXPLUGINS)
		errors.push('There are ' + card.plugins.length + ' plugins: a project has at most ' + MAXPLUGINS + '. Make the rest in a second project.');

	var seen = {};

	card.plugins.forEach(function(plugin) {

		if (!/^[a-z][a-z0-9]{1,29}$/.test(plugin.id)) {
			errors.push('The name of a plugin is one lowercase word of 2 to 30 letters: "' + plugin.id + '".');
			return;
		}

		if (seen[plugin.id])
			errors.push('The plugin ' + plugin.id + ' is twice.');

		seen[plugin.id] = true;

		if (!plugin.fields.length)
			errors.push('The plugin ' + plugin.id + ' has no fields: write "FIELDS: *name:String, ...".');

		if (plugin.fields.length > MAXFIELDS)
			errors.push('The plugin ' + plugin.id + ' has ' + plugin.fields.length + ' fields: at most ' + MAXFIELDS + '.');

		if (!plugin.fields.some(f => f.required) && plugin.fields.length)
			plugin.fields[0].required = true;

		plugin.title = plugin.title || capitalize(plugin.id);
		// An icon by its name, with or without the classes; one that does not exist would leave the menu without an icon, so it is the folder
		var icon = plugin.icon.replace(/^ti ti-/, '').replace(/^ti-/, '');
		plugin.icon = 'ti ti-' + (isicon(icon) ? icon : 'folder');
		plugin.table = /^tbl_[a-z0-9_]+$/.test(plugin.table) ? plugin.table : ('tbl_' + singular(plugin.id));
		plugin.collection = capitalize(plugin.id);
	});

	return { card: card, errors: errors };
};

// A text is a card when it has the line of a plugin and the line of its fields
exports.iscard = function(text) {
	return /^[\s>*`-]*PLUGIN\s*:/im.test(text || '') && /^[\s>*`-]*FIELDS\s*:/im.test(text || '');
};

// The fields are written as the input of an action writes them, the required ones with a star before the name: one notation everywhere
function fieldsline(plugin) {
	return plugin.fields.map(f => (f.required ? '*' : '') + f.name + ':' + f.type).join(', ');
}

// The card of one plugin, as it is written
function plugincard(plugin) {
	return ['PLUGIN: ' + plugin.id, 'TITLE: ' + plugin.title, 'ICON: ' + plugin.icon, 'TABLE: ' + plugin.table, 'FIELDS: ' + fieldsline(plugin)].join('\n');
}

exports.text = function(card) {
	return 'APP: ' + card.app + '\n\n' + card.plugins.map(plugincard).join('\n\n');
};

// The names that every file of a plugin uses: they come from the card, not from what a model remembers
function contract(plugin) {
	var id = plugin.id;
	var c = plugin.collection;
	return {
		actions: [c + '|list', c + '|read', c + '|save', c + '|remove'],
		endpoints: [id, id + '_read/{id}', id + '_save', id + '_remove/{id}'],
		form: 'form' + id
	};
}

exports.contract = contract;

function read(file) {
	return Total.Fs.readFileSync(PATH.private('project/' + file), 'utf8');
}

// The server part of a plugin: its place in the menu and its routes. It is the same for every plugin but for the names.
function pluginindex(plugin, position) {
	var c = contract(plugin);
	var pad = function(text) {
		return (text + '                              ').substring(0, Math.max(24, text.length + 1));
	};
	return [
		'exports.icon = \'' + plugin.icon + '\';',
		'exports.name = \'@' + '(' + plugin.title + ')\';',
		'exports.position = ' + position + ';',
		'exports.visible = function() {',
		'	return true;',
		'};',
		'',
		'exports.install = function() {',
		'	ROUTE(\'+API    ?    -' + pad(c.endpoints[0]) + ' --> ' + c.actions[0] + '\');',
		'	ROUTE(\'+API    ?    -' + pad(c.endpoints[1]) + ' --> ' + c.actions[1] + '\');',
		'	ROUTE(\'+API    ?    +' + pad(c.endpoints[2]) + ' --> ' + c.actions[2] + '\');',
		'	ROUTE(\'+API    ?    -' + pad(c.endpoints[3]) + ' --> ' + c.actions[3] + '\');',
		'};',
		''
	].join('\n');
}

exports.pluginindex = pluginindex;

// The files of the shell: an application with a menu that mounts the screens of its plugins. They are the files of an application that
// was checked in a browser.
function shell(card) {
	var title = capitalize(card.app.replace(/-/g, ' '));
	return [
		{ path: 'package.json', content: JSON.stringify({ name: card.app, version: '1.0.0', private: true, scripts: { start: 'node index.js 8000' }, dependencies: { total5: '>=0.0.20-2' } }, null, '\t') + '\n' },
		{ path: 'index.js', content: Total.Fs.readFileSync(PATH.root('private/start/index.js'), 'utf8') },
		{ path: 'config', content: 'name              : ' + title + '\n\n// The application listens only on this computer: it has one user and no sign in\n$ip               : 127.0.0.1\n' },
		{ path: 'controllers/default.js', content: read('shell/controllers/default.js') },
		{ path: 'definitions/auth.js', content: read('shell/definitions/auth.js') },
		{ path: 'definitions/init.js', content: read('shell/definitions/init.js') },
		{ path: 'views/index.html', content: read('shell/views/index.html') },
		{ path: 'public/css/default.css', content: read('shell/public/css/default.css') }
	];
}

// The tasks of a card: [{ id, plugin, path, title, kind: 'fixed' | 'model', part, status: 'pending' }]
exports.tasks = function(card) {

	var tasks = [{ plugin: '', path: '', kind: 'fixed', part: 'shell', title: 'The files that every application has: the start script, the menu and the layout' }];

	card.plugins.forEach(function(plugin) {
		var base = 'plugins/' + plugin.id + '/';
		tasks.push({ plugin: plugin.id, path: base + 'index.js', kind: 'fixed', part: 'index', title: 'The menu entry and the routes of ' + plugin.title });
		tasks.push({ plugin: plugin.id, path: base + 'actions/' + plugin.id + '.js', kind: 'model', part: 'actions', title: 'The actions of ' + plugin.title });
		tasks.push({ plugin: plugin.id, path: base + 'public/index.html', kind: 'model', part: 'screen', title: 'The screen of ' + plugin.title });
		tasks.push({ plugin: plugin.id, path: base + 'public/form.html', kind: 'model', part: 'form', title: 'The form of ' + plugin.title });
	});

	tasks.forEach(function(task, index) {
		task.id = index + 1;
		task.status = 'pending';
	});

	return tasks;
};

var REFERENCE = { actions: ['actions.js', 'js'], screen: ['index.html', 'html'], form: ['form.html', 'html'] };

// What the model gets for one task: one file to write, the card of its plugin, the names the other files use and a file that works
exports.prompt = function(plan, task, problem) {

	var plugin = plan.card.plugins.findItem('id', task.plugin);
	var c = contract(plugin);
	var ref = REFERENCE[task.part];
	var lines = [];

	lines.push('Task ' + task.id + ' of ' + plan.tasks.length + ' of the application "' + plan.card.app + '". Write ONE file with the write tool: `' + task.path + '`');
	lines.push('');
	lines.push('The plugin:');
	lines.push(plugincard(plugin));
	lines.push('');
	lines.push('Names that the other files of the application already use. Use exactly these:');
	lines.push('- actions: ' + c.actions.join(', '));
	lines.push('- endpoints of the API: ' + c.endpoints.join(', '));
	lines.push('- the form is opened with SET(\'common.form\', \'' + c.form + '\') and its data is the path ' + c.form);
	lines.push('- the screen is PLUGINS.' + plugin.id + ': the form calls PLUGINS.' + plugin.id + '.refresh() after it saves');
	lines.push('');

	if (task.part === 'actions')
		lines.push('Write the four actions ' + c.actions.join(', ') + ' on the table \'nosql/' + plugin.table + '\'. The input of ' + c.actions[2] + ' is exactly: \'id:UID, ' + fieldsline(plugin) + '\'');
	else if (task.part === 'screen')
		lines.push('Write the screen: the list of the items with the main field, a button to create one, a click on an item to edit it and a way to remove it.');
	else
		lines.push('Write the form: one input for each field of the plugin, the required ones with required:1, and the submit that calls the endpoint ' + c.endpoints[2] + ' with the id and every field.');

	lines.push('');
	lines.push('This is the same file of a plugin called "tasks" (fields name:String*, note:String) of an application that works. Keep its shape, and change the names, the texts and the fields to the ones of this plugin:');
	lines.push('');
	lines.push('```' + ref[1]);
	lines.push(read('reference/' + ref[0]).trim());
	lines.push('```');
	lines.push('');

	if (problem) {
		lines.push('The file you wrote has a problem: ' + problem);
		lines.push('Write the whole file again without it.');
		lines.push('');
	}

	lines.push('Write only `' + task.path + '`, the whole file. Do not write another file and do not explain it.');
	return lines.join('\n');
};

// What the model gets to fill the card from a request
exports.planprompt = function(request) {
	return [
		'Plan a Total.js 5 application for this request. Do not write code and do not use a tool: answer only with the card below, filled in.',
		'',
		'Request: ' + request,
		'',
		'The application is made of plugins. A plugin is one kind of thing that the application keeps (products, customers, orders), with its list and its form. Write one block for each plugin:',
		'',
		'APP: name-of-the-application',
		'',
		'PLUGIN: products',
		'TITLE: Products',
		'ICON: ti ti-folder',
		'FIELDS: *name:String, price:Number, isactive:Boolean',
		'',
		'Rules of the card:',
		'- PLUGIN is one lowercase English word in plural, without spaces. At most ' + MAXPLUGINS + ' plugins: only what the request asks for.',
		'- FIELDS are lowercase names with a type: ' + TYPES.join(', ') + '. A * before the name is a required field, as in the input of an action. Do not write id or dates: every row has them.',
		'- ICON is "ti ti-" and the name of an icon; leave "ti ti-folder" when you are not sure.',
		'- Answer with the card and nothing else.'
	].join('\n');
};

function planfile(root) {
	return Total.Path.join(root, '.totem/project.json');
}

exports.load = function(root) {
	try {
		return JSON.parse(Total.Fs.readFileSync(planfile(root), 'utf8'));
	} catch (e) {
		return null;
	}
};

// For people: the card, the names and the list of tasks with what is done
exports.markdown = function(plan) {

	var lines = ['# Project: ' + plan.card.app, ''];

	plan.request && lines.push('Request: ' + plan.request.replace(/\s+/g, ' ').substring(0, 600), '');
	lines.push('This file is written by Totem. `/build` makes the tasks that are not done; change the card with `/project` and the card.', '');
	lines.push('## Architecture', '', '```', exports.text(plan.card), '```', '');
	lines.push('## Names', '');

	plan.card.plugins.forEach(function(plugin) {
		var c = contract(plugin);
		lines.push('- **' + plugin.id + '**: table `' + plugin.table + '`; actions `' + c.actions.join('`, `') + '`; endpoints `' + c.endpoints.join('`, `') + '`');
	});

	lines.push('', '## Tasks', '');

	plan.tasks.forEach(function(task) {
		lines.push('- [' + (task.status === 'done' ? 'x' : ' ') + '] ' + task.id + '. ' + task.title + (task.path ? ' (`' + task.path + '`)' : '') + (task.status === 'failed' ? ' — not done: ' + (task.problem || 'the file was not written') : '') + (task.repaired && task.status === 'done' ? ' — ' + task.repaired : ''));
	});

	return lines.join('\n') + '\n';
};

exports.save = function(root, plan) {
	Total.Fs.mkdirSync(Total.Path.join(root, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(planfile(root), JSON.stringify(plan, null, '\t') + '\n');
	Total.Fs.writeFileSync(Total.Path.join(root, '.totem/project.md'), exports.markdown(plan));
};

// A card becomes the plan of the project. The tasks of a plugin that did not change and are done stay done.
exports.plan = function(root, card, request) {

	var before = exports.load(root);
	var plan = { version: 1, request: request || (before ? before.request : ''), card: card, tasks: exports.tasks(card), dtcreated: new Date().toISOString() };

	if (before && before.card) {
		plan.tasks.forEach(function(task) {
			var old = (before.tasks || []).find(t => t.path === task.path && t.part === task.part);
			var same = !task.plugin || JSON.stringify(before.card.plugins.findItem('id', task.plugin) || null) === JSON.stringify(card.plugins.findItem('id', task.plugin));
			if (old && old.status === 'done' && same)
				task.status = 'done';
		});
	}

	exports.save(root, plan);
	return plan;
};

// "/project ..." and "/build": what the prompt of the user is for the project, or null
exports.command = function(root, text) {

	var match = (text || '').match(/^\/(project|build)\b\s*([\s\S]*)$/);

	if (!match)
		return null;

	if (match[1] === 'build')
		return { kind: 'build', expanded: 'Build the project: make the tasks of .totem/project.md that are not done, one by one.' };

	var request = match[2].trim();

	if (exports.iscard(request))
		return { kind: 'card', request: request, expanded: 'Keep this card as the plan of the project:\n\n' + request };

	if (!request)
		return { kind: 'show', expanded: 'Show the plan of the project.' };

	return { kind: 'plan', request: request, expanded: exports.planprompt(request) };
};

// An assistant message that Totem writes itself
function say(session, text, callback) {
	var message = { id: UID(), sessionid: session.id, role: 'assistant', model: 'totem', dtcreated: FUNC.stamp() };
	var part = { id: UID(), messageid: message.id, sessionid: session.id, type: 'text', data: { text: text }, dtcreated: NOW, seq: 0 };
	NOSQL('messages').insert(message).callback(function() {
		NOSQL('parts').insert(part).callback(function() {
			FUNC.emit(session.id, 'message.created', { message: message });
			FUNC.emit(session.id, 'part.created', { part: part });
			FUNC.emit(session.id, 'part.closed', { partid: part.id });
			callback && callback();
		});
	});
}

exports.say = say;

function summary(plan) {
	var model = plan.tasks.filter(t => t.kind === 'model').length;
	return 'The plan of **' + plan.card.app + '** is saved in `.totem/project.md`: ' + plan.card.plugins.length + ' plugin' + (plan.card.plugins.length === 1 ? '' : 's') + ' and ' + plan.tasks.length + ' tasks (' + model + ' written by the model, the rest are fixed files).\n\n```\n' + exports.text(plan.card) + '\n```\n\nSend `/build` to make them one by one, or `/project` with the card changed.';
}

// The text of the last answer of the model in a session
function lastanswer(sessionid, callback) {
	NOSQL('messages').find().where('sessionid', sessionid).sort('dtcreated').callback(function(err, messages) {
		var last = (messages || []).filter(m => m.role === 'assistant').pop();
		if (!last) {
			callback('');
			return;
		}
		NOSQL('parts').find().where('messageid', last.id).sort('dtcreated').callback(function(err, parts) {
			var text = (parts || []).filter(p => p.type === 'text' && p.data && p.data.text).map(p => p.data.text).join('\n');
			// A model whose thinking was not switched off can leave its whole answer there: the card is read from it
			callback(text.trim() ? text : (parts || []).filter(p => p.type === 'reasoning' && p.data && p.data.text).map(p => p.data.text).join('\n'));
		});
	});
}

function setstatus(session, status) {
	NOSQL('sessions').modify({ status: status, dtupdated: NOW }).where('id', session.id).callback(NOOP);
	FUNC.emit(session.id, 'session.status', { status: status });
}

function accept(session, project, text, request, callback) {

	var parsed = exports.parse(text, Total.Path.basename(project.path));

	if (parsed.errors.length) {
		say(session, 'The card is not complete yet:\n\n- ' + parsed.errors.join('\n- ') + '\n\nSend `/project` with the card corrected:\n\n```\nAPP: name\n\nPLUGIN: products\nTITLE: Products\nICON: ti ti-folder\nFIELDS: *name:String, price:Number\n```', callback);
		return;
	}

	say(session, summary(exports.plan(project.path, parsed.card, request)), callback);
}

// Starts what the command asks. The user message is already stored with the expanded text.
exports.start = function(session, project, message, command, callback) {

	if (command.kind === 'show') {
		var plan = exports.load(project.path);
		say(session, plan ? exports.markdown(plan) : 'This project has no plan yet. Send `/project` and what the application must do.', callback);
		return;
	}

	if (command.kind === 'card') {
		accept(session, project, command.request, '', callback);
		return;
	}

	if (command.kind === 'plan') {
		MODS.agent.run(session, project, message, function(err) {
			if (err) {
				callback && callback(err);
				return;
			}
			lastanswer(session.id, function(text) {
				accept(session, project, text, command.request, callback);
			});
		});
		return;
	}

	exports.build(session, project, callback);
};

// The input of the action that saves is the card, word for word: 'id:UID' and the fields of the plugin. A small model writes the fields and
// misplaces a star (a required id refuses every new row). It is not asked again for that: the line is set from the card, as the names are.
// true when the file was changed.
exports.repair = function(root, plan, task) {

	var file = Total.Path.join(root, task.path);
	var content;

	try {
		content = Total.Fs.readFileSync(file, 'utf8');
	} catch (e) {
		return false;
	}

	var plugin = plan.card.plugins.findItem('id', task.plugin);

	// The screen and the form: the names of the example plugin ("tasks") that the model left where the names of this plugin go. Only the
	// names that come from the card (the endpoints, the path of the form, the plugin of the screen), never a text or a field.
	if (task.part !== 'actions') {

		if (plugin.id === 'tasks')
			return false;

		var id = plugin.id;
		var renamed = content
			.replace(/\bformtasks\b/g, 'form' + id)
			.replace(/\bPLUGINS\.tasks\b/g, 'PLUGINS.' + id)
			.replace(/(tapi\(\s*['"])tasks(_read\/|_save\b|_remove\/|\s+ERROR\b|['"])/g, '$1' + id + '$2');

		if (renamed === content)
			return false;

		Total.Fs.writeFileSync(file, renamed);
		return true;
	}

	var start = content.indexOf('NEWACTION(\'' + contract(plugin).actions[2] + '\'');

	if (start === -1)
		return false;

	// The input of that action: the first one after its name and before the next action
	var end = content.indexOf('NEWACTION(', start + 10);
	var block = content.substring(start, end === -1 ? content.length : end);
	var expected = 'id:UID, ' + fieldsline(plugin);
	var fixed = block.replace(/(\binput\s*:\s*)(['"])([^'"\n]*)\2/, function(all, key, quote, value) {
		return value === expected ? all : (key + '\'' + expected + '\'');
	});

	if (fixed === block)
		return false;

	Total.Fs.writeFileSync(file, content.substring(0, start) + fixed + (end === -1 ? '' : content.substring(end)));
	return true;
};

// A file of a task that is there and has what the other files expect: '' or the problem in a sentence
exports.check = function(root, plan, task, callback) {

	var file = Total.Path.join(root, task.path);
	var content;

	try {
		content = Total.Fs.readFileSync(file, 'utf8');
	} catch (e) {
		callback('the file ' + task.path + ' was not written.');
		return;
	}

	var plugin = plan.card.plugins.findItem('id', task.plugin);
	var c = contract(plugin);
	var missing;

	if (task.part === 'actions') {

		missing = c.actions.filter(name => content.indexOf('NEWACTION(\'' + name + '\'') === -1);

		if (missing.length) {
			callback('it must define the actions ' + missing.join(', ') + ' with NEWACTION(\'Name|verb\', ...).');
			return;
		}

		if (content.indexOf('nosql/' + plugin.table) === -1) {
			callback('the actions must use the table \'nosql/' + plugin.table + '\'.');
			return;
		}

		// The input of the action that saves: every field with its type, the star of a required one before its name
		var input = (content.match(/input\s*:\s*'([^']*)'/g) || []).map(text => text.replace(/^input\s*:\s*'|'$/g, '')).find(text => plugin.fields.every(f => new RegExp('(^|[\\s,*])' + f.name + '\\s*:').test(text))) || '';
		var declared = {};

		input.split(',').forEach(function(item) {
			var field = item.trim().match(/^(\*?)([A-Za-z0-9_]+)\s*:\s*([A-Za-z]+)(.*)$/);
			if (field)
				declared[field[2]] = { required: !!field[1], type: field[3], rest: field[4].trim() };
		});

		missing = plugin.fields.filter(f => !declared[f.name] || declared[f.name].type !== f.type || declared[f.name].required !== f.required || declared[f.name].rest);

		// A required id would refuse every new row: the id is there only when a row is changed
		if (!missing.length && (!declared.id || declared.id.required || declared.id.type !== 'UID'))
			missing = [{ name: 'id' }];

		if (missing.length) {
			callback('the input of ' + c.actions[2] + ' must be exactly \'id:UID, ' + fieldsline(plugin) + '\': the star of a required field goes before its name and nothing follows the type.');
			return;
		}

		// The file must be JavaScript that Node.js accepts
		Total.Child.execFile(process.execPath, ['--check', file], { timeout: 15000 }, function(err, stdout, stderr) {
			callback(err ? ('it is not valid JavaScript: ' + ((stderr || '').split('\n').filter(line => /Error/.test(line))[0] || 'syntax error')) : '');
		});
		return;
	}

	if (content.indexOf('PLUGIN(function(exports)') === -1) {
		callback('it must have the block PLUGIN(function(exports) { ... }) of the reference.');
		return;
	}

	if (task.part === 'screen') {

		if (content.indexOf('<ui-plugin') === -1) {
			callback('it must start with <ui-plugin class="CLASS">.');
			return;
		}

		missing = [plugin.id + ' ERROR', plugin.id + '_remove/', c.form].filter(text => content.indexOf(text) === -1);

		if (missing.length) {
			callback('it must use ' + missing.map(text => '"' + text + '"').join(', ') + ' as the reference does with the names of its plugin.');
			return;
		}

		if (/tasks_|formtasks|PLUGINS\.tasks/.test(content) && plugin.id !== 'tasks') {
			callback('it still has names of the reference plugin "tasks": change them to "' + plugin.id + '".');
			return;
		}

		if (!plugin.fields.some(f => f.name === 'note') && /\bm\.note\b/.test(content)) {
			callback('it still shows the field "note" of the reference plugin, which this plugin does not have: show ' + plugin.fields.slice(0, 2).map(f => 'm.' + f.name).join(' and ') + '.');
			return;
		}

		if (!new RegExp('\\bm\\.' + plugin.fields[0].name + '\\b').test(content)) {
			callback('the list must show the main field of each item: {{ m.' + plugin.fields[0].name + ' }}.');
			return;
		}

		callback('');
		return;
	}

	if (content.indexOf('miniform') === -1 || content.indexOf(plugin.id + '_save') === -1) {
		callback('it must be a miniform whose submit calls the endpoint ' + plugin.id + '_save.');
		return;
	}

	missing = plugin.fields.filter(f => content.indexOf('?.' + f.name) === -1);

	if (missing.length) {
		callback('it must have one input for each field: path="?.' + missing[0].name + '" is missing' + (missing.length > 1 ? ' (and ' + (missing.length - 1) + ' more)' : '') + '.');
		return;
	}

	if (!plugin.fields.some(f => f.name === 'note') && /\?\.note\b|model\.note\b/.test(content)) {
		callback('it still has the field "note" of the reference plugin, which this plugin does not have.');
		return;
	}

	if (/tasks_save|PLUGINS\.tasks/.test(content) && plugin.id !== 'tasks') {
		callback('it still has names of the reference plugin "tasks": change them to "' + plugin.id + '".');
		return;
	}

	callback('');
};

// The fixed files of a task: [{ path, content }], without the ones that are already there
function fixedfiles(root, plan, task) {
	var files = task.part === 'shell' ? shell(plan.card) : [{ path: task.path, content: pluginindex(plan.card.plugins.findItem('id', task.plugin), plan.card.plugins.findIndex('id', task.plugin) + 1) }];
	return files.filter(file => !Total.Fs.existsSync(Total.Path.join(root, file.path)));
}

// One run of the agent for one task: a user message that the conversation shows as the task, and the instruction that the model gets
function runtask(session, project, plan, task, problem, callback) {

	var files = task.kind === 'fixed' ? fixedfiles(project.path, plan, task) : null;

	// Fixed files that are all there: nothing to do
	if (files && !files.length) {
		callback(null);
		return;
	}

	var message = { id: UID(), sessionid: session.id, role: 'user', dtcreated: FUNC.stamp() };
	var data = { text: 'Task ' + task.id + ' of ' + plan.tasks.length + ': ' + task.title + (task.path ? ' (`' + task.path + '`)' : '') + (problem ? ' — again: ' + problem : '') };

	data.task = { id: task.id, path: task.path, kind: task.kind };

	if (files) {
		data.task.files = files;
		data.expanded = 'Write the fixed files of this task.';
	} else
		data.expanded = exports.prompt(plan, task, problem);

	var part = { id: UID(), messageid: message.id, sessionid: session.id, type: 'text', data: data, dtcreated: NOW, seq: 0 };

	NOSQL('messages').insert(message).callback(function() {
		NOSQL('parts').insert(part).callback(function() {
			FUNC.emit(session.id, 'message.created', { message: message });
			FUNC.emit(session.id, 'part.created', { part: part });
			MODS.agent.run(session, project, message, callback);
		});
	});
}

// Walks the tasks that are not done, one by one. A task of the model that fails its check is asked once more with the problem; if it fails
// again the build stops there and says why, and the next /build starts at that task.
exports.build = function(session, project, callback) {

	var plan = exports.load(project.path);

	if (!plan) {
		say(session, 'This project has no plan yet. Send `/project` and what the application must do.', callback);
		return;
	}

	if (session.mode === 'plan') {
		say(session, 'The session is in Plan mode, which writes nothing. Change it to Build and send `/build` again.', callback);
		return;
	}

	var state = MAIN.building[session.id] = { aborted: false, done: 0 };

	var end = function(text) {
		delete MAIN.building[session.id];
		exports.save(project.path, plan);
		say(session, text, function() {
			setstatus(session, 'idle');
			callback && callback();
		});
	};

	var next = function() {

		if (state.aborted) {
			end('The build was stopped. ' + plan.tasks.filter(t => t.status === 'done').length + ' of ' + plan.tasks.length + ' tasks are done; `/build` goes on with the rest.');
			return;
		}

		var task = plan.tasks.find(t => t.status !== 'done');

		if (!task) {
			end('All the ' + plan.tasks.length + ' tasks of **' + plan.card.app + '** are done' + (state.done ? '' : ' (nothing was left to do)') + '. To run the application: `npm install` and `node index.js 8000`, then open http://127.0.0.1:8000/');
			return;
		}

		var target = task.path ? Total.Path.join(project.path, task.path) : '';

		// A file of the model that is already there is not written over: when it passes the check of its task the task is done, and when it
		// does not, the person decides (it may be a file that they changed)
		if (task.kind === 'model' && Total.Fs.existsSync(target)) {
			exports.check(project.path, plan, task, function(found) {
				if (found) {
					task.status = 'failed';
					task.problem = found;
					end('The build stopped at the task ' + task.id + ': `' + task.path + '` is already there and ' + found + '\n\nCorrect it or remove it, and send `/build` again.');
				} else {
					task.status = 'done';
					delete task.problem;
					exports.save(project.path, plan);
					next();
				}
			});
			return;
		}

		var attempt = function(problem, again) {
			runtask(session, project, plan, task, problem, function(err) {

				if (state.aborted) {
					next();
					return;
				}

				if (err) {
					task.status = 'failed';
					task.problem = FUNC.plain ? FUNC.plain(err + '') : (err + '');
					end('The build stopped at the task ' + task.id + ' (`' + (task.path || 'the shell') + '`): ' + task.problem + '\n\n`/build` tries that task again.');
					return;
				}

				var verify = task.kind === 'fixed' ? function(done) {
					var left = fixedfiles(project.path, plan, task);
					done(left.length ? ('the file ' + left[0].path + ' was not written.') : '');
				} : function(done) {
					if (exports.repair(project.path, plan, task))
						task.repaired = task.part === 'actions' ? 'the input of the action that saves was set from the card' : 'the names of the example plugin were changed to the ones of the card';
					exports.check(project.path, plan, task, done);
				};

				verify(function(found) {

					if (!found) {
						task.status = 'done';
						delete task.problem;
						state.done++;
						exports.save(project.path, plan);
						next();
						return;
					}

					if (task.kind === 'model' && !again) {
						// The file of the first try was made by this task a moment ago: it is removed so that the second try writes it whole
						try {
							Total.Fs.unlinkSync(target);
						} catch (e) {}
						attempt(found, true);
						return;
					}

					task.status = 'failed';
					task.problem = found;
					end('The build stopped at the task ' + task.id + ' (`' + task.path + '`): ' + found + '\n\nCorrect the file by hand or send `/build` to try that task again.');
				});
			});
		};

		attempt('', false);
	};

	next();
};

// Who waits for the plan or the build of a session to end (the API for other agents answers when it does)
var WAITING = {};

exports.wait = function(sessionid) {
	return new Promise(function(resolve) {
		(WAITING[sessionid] = WAITING[sessionid] || []).push(resolve);
	});
};

// err: why the model could not do it (it does not answer, it is not installed), when that is what happened
exports.finished = function(sessionid, err) {
	var list = WAITING[sessionid] || [];
	delete WAITING[sessionid];
	list.forEach(resolve => resolve(err || null));
};

// For another agent, in as few words as possible: what is done, what failed and what is next
exports.status = function(plan, building) {

	if (!plan)
		return 'no plan yet: send the card of the application to "project"';

	var done = plan.tasks.filter(t => t.status === 'done').length;
	var failed = plan.tasks.filter(t => t.status === 'failed');
	var pending = plan.tasks.filter(t => t.status === 'pending');
	var lines = [plan.card.app + ': ' + done + ' of ' + plan.tasks.length + ' tasks done' + (building ? ' (building)' : '')];

	failed.forEach(function(task) {
		lines.push('failed ' + task.id + ' ' + (task.path || 'shell') + ': ' + (task.problem || 'not written'));
	});

	if (pending.length && !building)
		lines.push('pending: ' + pending.map(t => t.id).join(', ') + ' (send "build")');

	if (done === plan.tasks.length)
		lines.push('run it: npm install && node index.js 8000');

	return lines.join('\n');
};

exports.abort = function(sessionid) {
	if (MAIN.building[sessionid])
		MAIN.building[sessionid].aborted = true;
};
