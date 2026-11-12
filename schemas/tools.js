// The tools of the agent. They run inside the project root of the session ($.user.root) and are never routed:
// the agent calls them with ACTION() after the permission check. Definitions for the model come from the input declarations.

var SKIP = { 'node_modules': 1, '.git': 1, 'databases': 1, 'tmp': 1 };
var MAXLINES = 2000;

function walk(root, base, filter, output, max) {
	var entries;
	try {
		entries = Total.Fs.readdirSync(base, { withFileTypes: true });
	} catch (e) {
		return;
	}
	for (var entry of entries) {
		if (output.length >= max)
			return;
		if (SKIP[entry.name])
			continue;
		var full = Total.Path.join(base, entry.name);
		if (entry.isDirectory())
			walk(root, full, filter, output, max);
		else if (entry.isFile()) {
			var relative = Total.Path.relative(root, full).split(Total.Path.sep).join('/');
			if (!filter || filter.test(relative))
				output.push(relative);
		}
	}
}

NEWACTION('Tools|read', {
	name: 'Read a file',
	summary: 'Reads a text file of the project, or lists a directory. Lines are numbered.',
	input: '*path:String // Path relative to the project root, offset:Number // First line to read (1 is the first), limit:Number // Number of lines to read',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var stat;
		try {
			stat = Total.Fs.statSync(path);
		} catch (e) {
			$.invalid('@(File not found)');
			return;
		}

		if (stat.isDirectory()) {
			var names = Total.Fs.readdirSync(path, { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? '/' : ''));
			$.callback(names.sort().join('\n'));
			return;
		}

		var lines = Total.Fs.readFileSync(path, 'utf8').split('\n');
		var offset = Math.max((model.offset || 1) - 1, 0);
		var limit = model.limit || MAXLINES;
		var output = [];

		for (var i = offset; i < Math.min(lines.length, offset + limit); i++)
			output.push((i + 1) + '\t' + lines[i]);

		var text = output.join('\n');
		if (offset + limit < lines.length)
			text += '\n[{0} more lines, use offset]'.format(lines.length - offset - limit);

		$.callback(FUNC.truncate(text));
	}
});

NEWACTION('Tools|glob', {
	name: 'Find files',
	summary: 'Finds files of the project by glob pattern, for example src/**/*.js. Skips node_modules and .git.',
	input: '*pattern:String // Glob pattern relative to the project root',
	action: function($, model) {
		var output = [];
		walk($.user.root, $.user.root, FUNC.glob(model.pattern), output, 500);
		$.callback(output.length ? output.sort().join('\n') : '(no files)');
	}
});

NEWACTION('Tools|grep', {
	name: 'Search in files',
	summary: 'Searches file contents with a regular expression. Returns path:line:text.',
	input: '*pattern:String // Regular expression, path:String // Folder or file to search (default the project root), include:String // Glob filter for file paths such as *.js',
	action: function($, model) {

		var root = $.user.root;
		var path = FUNC.resolve(root, model.path || '.');
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var regex;
		try {
			regex = new RegExp(model.pattern);
		} catch (e) {
			$.invalid('@(Invalid regular expression)');
			return;
		}

		var include = model.include ? FUNC.glob(model.include.indexOf('/') === -1 ? ('**/' + model.include) : model.include) : null;
		var files = [];
		var stat = Total.Fs.statSync(path);

		if (stat.isFile())
			files.push(Total.Path.relative(root, path).split(Total.Path.sep).join('/'));
		else
			walk(root, path, include, files, 5000);

		var output = [];
		for (var file of files) {
			// Search must not bypass the read permission of secret files. Read one explicitly to request access.
			if (MODS.permissions.issecret(file))
				continue;
			var text;
			try {
				text = Total.Fs.readFileSync(Total.Path.join(root, file), 'utf8');
			} catch (e) {
				continue;
			}
			if (text.indexOf('\u0000') !== -1)
				continue;
			var lines = text.split('\n');
			for (var i = 0; i < lines.length; i++) {
				if (regex.test(lines[i]))
					output.push('{0}:{1}:{2}'.format(file, i + 1, lines[i].substring(0, 300)));
				if (output.length >= 200)
					break;
			}
			if (output.length >= 200)
				break;
		}

		$.callback(output.length ? FUNC.truncate(output.join('\n')) : '(no matches)');
	}
});

NEWACTION('Tools|write', {
	name: 'Write a file',
	summary: 'Creates a file or replaces it with the given content. Creates missing folders.',
	input: '*path:String // Path relative to the project root, *content:Text // Full content of the file',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		// A model copies the name of the file as the first line of its code (# index.js in a .js file, // package.json in a JSON file): that line is
		// not part of the file and breaks it, so it is left out. Only that line, only when it is the name of this file.
		var content = model.content;
		var base = Total.Path.basename(model.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		var first = content.split('\n')[0];
		var named = new RegExp('^\\s*(#|//|<!--)\\s*(?:[\\w./-]*/)?' + base + '\\s*(-->)?\\s*$');
		var dropped = '';

		// The comment style that the language of the file allows: js //, html <!--, json and css none. A line in another style would break the file.
		var ext = (Total.Path.extname(model.path) || '').toLowerCase();
		var style = (first.match(/^\s*(#|\/\/|<!--)/) || [])[1];
		var allowed = { '.js': '//', '.mjs': '//', '.cjs': '//', '.html': '<!--' }[ext];
		var breaks = style && ['.js', '.mjs', '.cjs', '.html', '.json', '.css'].indexOf(ext) !== -1 && style !== allowed;

		// The recipes show a file with its whole path in a comment above the code (// schemas/products.js). That line says where the code goes: it
		// is not code either, in any style. A comment with only the name of the file (// ok.js) may be the author's and stays.
		var marker = model.path.indexOf('/') !== -1 && first.replace(/^\s*(#|\/\/|<!--)\s*|\s*(-->)?\s*$/g, '') === model.path.replace(/^\.?\//, '');

		if ((breaks || marker) && named.test(first)) {
			content = content.split('\n').slice(1).join('\n');
			dropped = '\nThe first line was the name of the file, not code: it was left out.';
		}

		MODS.snapshots.before($.user, model.path, path);
		Total.Fs.mkdirSync(Total.Path.dirname(path), { recursive: true });
		Total.Fs.writeFileSync(path, content, 'utf8');
		var note = MODS.formatter.run($.user.root, path, MODS.settings.of($.user)) + MODS.diagnostics.run($.user.root, path, MODS.settings.of($.user));
		$.callback('Written {0} ({1} lines)'.format(model.path, content.split('\n').length) + dropped + note + MODS.conventions.review(path, content, MODS.settings.of($.user)));
	}
});

NEWACTION('Tools|edit', {
	name: 'Edit a file',
	summary: 'Replaces an exact piece of text in a file. The text must appear once unless all is true.',
	input: '*path:String // Path relative to the project root, *oldstring:Text // Exact text to replace, *newstring:Text // Replacement text, all:Boolean // Replace every occurrence',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var text;
		try {
			text = Total.Fs.readFileSync(path, 'utf8');
		} catch (e) {
			$.invalid('@(File not found)');
			return;
		}

		var count = text.split(model.oldstring).length - 1;

		if (!count) {
			$.invalid('@(The text was not found in the file)');
			return;
		}

		if (count > 1 && !model.all) {
			$.invalid('@(The text appears several times: add more context or set all)');
			return;
		}

		text = text.split(model.oldstring).join(model.newstring);
		MODS.snapshots.before($.user, model.path, path);
		Total.Fs.writeFileSync(path, text, 'utf8');
		var note = MODS.formatter.run($.user.root, path, MODS.settings.of($.user)) + MODS.diagnostics.run($.user.root, path, MODS.settings.of($.user));
		$.callback('Edited {0} ({1} replacement{2})'.format(model.path, count, count > 1 ? 's' : '') + note + MODS.conventions.review(path, text, MODS.settings.of($.user)));
	}
});

NEWACTION('Tools|bash', {
	name: 'Run a command',
	summary: 'Runs a shell command in the project root and returns its output. Has a timeout.',
	input: '*command:String // The command line, timeout:Number // Timeout in milliseconds, background:Boolean // Start it and return at once (a development server or a watcher) and read it later with the job tool',
	action: function($, model) {

		if (model.background) {
			var job = MODS.jobs.start($.user, model.command);
			setTimeout(() => $.callback('Started in the background as job {0}.\n{1}'.format(job.id, MODS.jobs.tail(job))), 1500);
			return;
		}

		var timeout = model.timeout || MODS.settings.of($.user).bashtimeout;
		var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8' };
		var child = Total.Child.spawn('/bin/sh', ['-c', model.command], { cwd: $.user.root, env: env });
		var sessionid = $.user.sessionid;
		var output = '';
		var killed = '';

		if (!MAIN.children[sessionid])
			MAIN.children[sessionid] = [];

		MAIN.children[sessionid].push(child);

		var timer = setTimeout(function() {
			killed = 'timeout';
			child.kill();
		}, timeout);

		var append = function(chunk) {
			if (output.length < MODS.settings.of($.user).maxoutput * 2)
				output += chunk;
		};

		child.stdout.on('data', append);
		child.stderr.on('data', append);

		child.on('close', function(code) {
			clearTimeout(timer);
			var list = MAIN.children[sessionid];
			if (list) {
				var index = list.indexOf(child);
				if (index !== -1)
					list.splice(index, 1);
				if (!list.length)
					delete MAIN.children[sessionid];
			}
			var text = FUNC.truncate(output);
			if (killed)
				text += '\n[stopped: ' + killed + ']';
			else
				text += '\n[exit code {0}]'.format(code);
			$.callback(text);
		});

		child.on('error', err => $.invalid(err.message));
	}
});


NEWACTION('Tools|job', {
	name: 'Read or stop a background command',
	summary: 'Shows the latest output and the state of a command started with bash and background. Set stop to end it. Without an id it lists the jobs of the session.',
	input: 'id:String // The job id, stop:Boolean // End the command',
	action: function($, model) {

		if (!model.id) {
			var list = MODS.jobs.list($.user.sessionid);
			$.callback(list.length ? list.map(job => '{0}  {1}  {2}'.format(job.id, job.status, job.command)).join('\n') : 'No jobs.');
			return;
		}

		var job = MODS.jobs.get($.user.sessionid, model.id);

		if (!job) {
			$.invalid('@(Job not found)');
			return;
		}

		if (model.stop)
			MODS.jobs.stop(job);

		setTimeout(() => $.callback('Job {0} is {1}.\n{2}'.format(job.id, job.status, MODS.jobs.tail(job))), model.stop ? 400 : 0);
	}
});

NEWACTION('Tools|patch', {
	name: 'Apply a patch',
	summary: 'Applies a multi-file patch. Format: "*** Begin Patch", then for each file "*** Add File: path" (lines start with +), "*** Delete File: path" or "*** Update File: path" with hunks that start with @@ and have lines that begin with a space (context), - (remove) or + (add), and finally "*** End Patch". Nothing is written when any hunk does not match.',
	input: '*patch:Text // The text of the patch',
	action: function($, model) {

		var parsed = MODS.patch.parse(model.patch);
		if (parsed.error) {
			$.invalid(parsed.error);
			return;
		}

		var plan = MODS.patch.plan($.user.root, parsed.ops);
		if (plan.error) {
			$.invalid(plan.error);
			return;
		}

		var summary = [];
		var review = '';

		for (var change of plan.changes) {
			MODS.snapshots.before($.user, change.path, change.full);
			if (change.kind === 'delete')
				Total.Fs.unlinkSync(change.full);
			else {
				Total.Fs.mkdirSync(Total.Path.dirname(change.full), { recursive: true });
				Total.Fs.writeFileSync(change.full, change.content, 'utf8');
			}
			summary.push('{0} {1}'.format(change.kind, change.path));
			if (change.kind !== 'delete') {
				review += MODS.formatter.run($.user.root, change.full, MODS.settings.of($.user)) + MODS.diagnostics.run($.user.root, change.full, MODS.settings.of($.user));
				review += MODS.conventions.review(change.full, change.content, MODS.settings.of($.user));
			}
		}

		$.callback(summary.join('\n') + review);
	}
});

NEWACTION('Tools|fetch', {
	name: 'Fetch a web page',
	summary: 'Downloads an http(s) URL and returns its text (HTML is reduced to text). Limited to 1 MB.',
	input: '*url:String // The address such as https://totaljs.com',
	action: function($, model) {
		MODS.fetcher.get(model.url, function(err, text) {
			if (err)
				$.invalid(err);
			else
				$.callback(FUNC.truncate(text));
		});
	}
});

NEWACTION('Tools|todo', {
	name: 'Update the task list',
	summary: 'Replaces the visible task list of the session. Use it to plan multi-step work and to mark progress.',
	input: '*todos:String // JSON array of objects with text and status (pending or in_progress or completed)',
	action: async function($, model) {

		var items;
		try {
			items = JSON.parse(model.todos);
		} catch (e) {
			$.invalid('@(The todos must be a JSON array)');
			return;
		}

		if (!Array.isArray(items)) {
			$.invalid('@(The todos must be a JSON array)');
			return;
		}

		var list = items.slice(0, 50).map(function(item, index) {
			var status = ['pending', 'in_progress', 'completed'].indexOf(item.status) === -1 ? 'pending' : item.status;
			return { id: UID(), sessionid: $.user.sessionid, text: ('' + (item.text || '')).substring(0, 300), status: status, index: index };
		});

		await NOSQL('todos').remove().where('sessionid', $.user.sessionid).promise();

		for (var todo of list)
			await NOSQL('todos').insert(todo).promise();

		FUNC.emit($.user.sessionid, 'todo.updated', { items: list });
		$.callback('Task list updated ({0} items)'.format(list.length));
	}
});

NEWACTION('Tools|ask', {
	name: 'Ask the user',
	summary: 'Asks the user a question and waits for the answer. Use it when you need a decision that you cannot make yourself.',
	input: '*question:String // The question, options:[String] // Suggested answers',
	action: function($, model) {

		// A scheduled run has nobody to answer
		if ($.user.unattended) {
			$.callback('(Nobody is here to answer: this is a scheduled run. Decide with what you know, or stop and say what is missing.)');
			return;
		}

		var id = UID();
		var sessionid = $.user.sessionid;

		var event = { type: 'question.ask', data: { id: id, text: model.question, options: model.options || [] } };
		MAIN.asks[id] = { kind: 'question', sessionid: sessionid, callback: answer => $.callback(answer), event: event };
		FUNC.emit(sessionid, event.type, event.data);
	}
});

NEWACTION('Tools|skill', {
	name: 'Load a skill',
	summary: 'Returns the instructions of a skill of the project. The available skills are listed in the system prompt.',
	input: '*name:String // The name of the skill',
	action: function($, model) {
		var body = MODS.instructions.skill($.user.root, model.name);
		if (body == null)
			$.invalid('@(Skill not found)');
		else
			$.callback(body);
	}
});


NEWACTION('Tools|task', {
	name: 'Run a sub-agent',
	summary: 'Delegates a task to a sub-agent that has its own context and a limited set of tools. Only its final answer comes back. Use it for research or a self-contained job that would fill your own context.',
	input: '*agent:String // The name of the agent, *prompt:String // The complete task with all that the agent needs to know because it does not see this conversation',
	action: function($, model) {

		var run = MAIN.running[$.user.sessionid];

		if (!run) {
			$.invalid('@(The session is not running)');
			return;
		}

		MODS.subagent.run(run, model.agent, model.prompt, $.user.callid, function(err, text) {
			if (err)
				$.invalid(FUNC.plain(err));
			else
				$.callback(text);
		});
	}
});
