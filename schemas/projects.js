NEWACTION('Projects|list', {
	name: 'List projects',
	summary: 'Lists the folders that Totem works in (id, name, path).',
	mcp: true,
	action: async function($) {
		var items = await NOSQL('projects').find().sort('dtopened_desc').promise($);
		$.callback(items);
	}
});

NEWACTION('Projects|open', {
	name: 'Open a project folder',
	input: '*path:String',
	action: async function($, model) {

		var path = Total.Path.resolve(model.path);
		var stat;

		try {
			stat = Total.Fs.statSync(path);
		} catch (e) {
			$.invalid('@(Folder not found)');
			return;
		}

		if (!stat.isDirectory()) {
			$.invalid('@(The path is not a folder)');
			return;
		}

		var item = await NOSQL('projects').read().where('path', path).promise($);

		if (item) {
			item.dtopened = NOW;
			await NOSQL('projects').modify({ dtopened: NOW }).where('id', item.id).promise($);
		} else {
			item = { id: UID(), name: Total.Path.basename(path), path: path, ownerid: $.user.id, dtcreated: NOW, dtopened: NOW };
			await NOSQL('projects').insert(item).promise($);
		}

		$.callback(item);
	}
});

NEWACTION('Projects|remove', {
	name: 'Forget a project',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		await MODS.schedules.clear(id);
		MODS.settings.clear('project', id);
		MODS.agents.clear(id);
		var sessions = await NOSQL('sessions').find().where('projectid', id).promise($);
		var ids = sessions.map(s => s.id);

		// One pass per collection, not one per session
		if (ids.length) {
			ids.forEach(sessionid => { MODS.agent.abort(sessionid); MODS.jobs.clear(sessionid); MODS.terminal.clear(sessionid); });
			await new Promise(resolve => MODS.snapshots.clear(ids, resolve));
			await new Promise(resolve => MODS.attachments.clear(ids, resolve));
			await new Promise(resolve => MODS.settings.clear('session', ids, resolve));
			await NOSQL('todos').remove().in('sessionid', ids).promise($);
			await NOSQL('parts').remove().in('sessionid', ids).promise($);
			await NOSQL('messages').remove().in('sessionid', ids).promise($);
			await NOSQL('sessions').remove().in('id', ids).promise($);
		}

		await NOSQL('permissions').remove().where('projectid', id).promise($);
		await NOSQL('projects').remove().where('id', id).promise($);
		$.success();
	}
});

NEWACTION('Projects|files', {
	name: 'List a folder of a project',
	params: '*id',
	query: 'path',
	action: async function($) {

		var project = await NOSQL('projects').read().where('id', $.params.id).error(404).promise($);
		var path = FUNC.resolve(project.path, $.query.path || '.');

		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var items = [];
		try {
			for (var entry of Total.Fs.readdirSync(path, { withFileTypes: true })) {
				if (entry.name !== '.git' && entry.name !== 'node_modules')
					items.push({ name: entry.name, directory: entry.isDirectory() });
			}
		} catch (e) {
			$.invalid('@(Folder not found)');
			return;
		}

		items.sort((a, b) => a.directory === b.directory ? a.name.localeCompare(b.name) : (a.directory ? -1 : 1));
		$.callback(items);
	}
});


NEWACTION('Projects|commands', {
	name: 'Commands and agents of a project',
	params: '*id',
	action: async function($) {
		var project = await NOSQL('projects').read().where('id', $.params.id).error(404).promise($);
		$.callback({
			commands: MODS.commands.list(project.path).map(c => ({ name: c.name, description: c.description })),
			agents: MODS.agents.list(project.path, project.id).map(a => ({ name: a.name, description: a.description, tools: a.tools }))
		});
	}
});

NEWACTION('Projects|git', {
	name: 'Git state of a project',
	summary: 'The branch of the project and the files that git sees as changed (empty when the folder is not a git repository).',
	params: '*id',
	action: async function($) {

		var project = await NOSQL('projects').read().where('id', $.params.id).error(404).promise($);
		var state = await new Promise(resolve => MODS.git.status(project.path, resolve));
		$.callback(state);
	}
});
