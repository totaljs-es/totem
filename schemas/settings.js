NEWACTION('Settings|read', {
	name: 'Settings of a scope',
	params: '*scope:String, *id:String',
	action: async function($) {

		var scope = $.params.scope;
		var id = $.params.id;
		var projectid = id;

		if (['global', 'project', 'session'].indexOf(scope) === -1) {
			$.invalid(400);
			return;
		}

		if (scope === 'session') {
			var session = await NOSQL('sessions').read().where('id', id).error(404).promise($);
			projectid = session.projectid;
		} else if (scope === 'project')
			await NOSQL('projects').read().where('id', id).error(404).promise($);

		$.callback(MODS.settings.read(scope, id, projectid));
	}
});

NEWACTION('Settings|save', {
	name: 'Change or reset one setting',
	input: '*scope:String, *id:String, *key:String, value:String, reset:Boolean',
	action: async function($, model) {

		if (['global', 'project', 'session'].indexOf(model.scope) === -1) {
			$.invalid(400);
			return;
		}

		var def = MODS.settings.def(model.key);

		if (!def) {
			$.invalid('@(This setting cannot be changed from Totem)');
			return;
		}

		if (model.scope === 'session')
			await NOSQL('sessions').read().where('id', model.id).error(404).promise($);
		else if (model.scope === 'project')
			await NOSQL('projects').read().where('id', model.id).error(404).promise($);

		var value;

		if (!model.reset) {
			var parsed = MODS.settings.coerce(def, model.value);
			if (parsed.error) {
				$.invalid(parsed.error);
				return;
			}
			value = parsed.value;
		}

		await new Promise(resolve => MODS.settings.set(model.scope, model.id, model.key, value, resolve));
		$.success();
	}
});
