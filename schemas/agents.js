NEWACTION('Agents|list', {
	name: 'Sub-agents of a project, and what they can be given',
	params: '*projectid:String',
	action: async function($) {

		var root = '';
		var projectid = $.params.projectid === 'all' ? '' : $.params.projectid;

		if (projectid) {
			var project = await NOSQL('projects').read().where('id', projectid).error(404).promise($);
			root = project.path;
		}

		// A sub-agent cannot start other agents
		var tools = Object.keys(MODS.agent.tools).filter(name => name !== 'task').sort();
		var items = MODS.agents.list(root, projectid);

		$.callback({ items: items, tools: tools, models: Object.keys(F.aimodels).sort() });
	}
});

NEWACTION('Agents|save', {
	name: 'Create or change a sub-agent',
	input: '*scope:String, projectid:String, *name:String, description:String, tools:[String], maxsteps:Number, model:String, *prompt:String',
	action: async function($, model) {

		if (['global', 'project'].indexOf(model.scope) === -1) {
			$.invalid(400);
			return;
		}

		if (model.scope === 'project')
			await NOSQL('projects').read().where('id', model.projectid).error(404).promise($);

		var name = (model.name || '').trim().toLowerCase();

		if (!MODS.agents.validname(name)) {
			$.invalid('@(The name uses lowercase letters, numbers and hyphens)');
			return;
		}

		var known = Object.keys(MODS.agent.tools).filter(tool => tool !== 'task');
		var tools = (model.tools || []).filter(tool => known.indexOf(tool) !== -1);

		if (!tools.length) {
			$.invalid('@(Choose at least one tool)');
			return;
		}

		if (model.model && !F.aimodels[model.model]) {
			$.invalid('@(This model is not available)');
			return;
		}

		var steps = Math.max(1, Math.min(100, parseInt(model.maxsteps) || 20));

		await new Promise(resolve => MODS.agents.save({ scope: model.scope, projectid: model.projectid, name: name, description: model.description, tools: tools, maxsteps: steps, model: model.model, prompt: model.prompt }, resolve));
		$.success();
	}
});

NEWACTION('Agents|remove', {
	name: 'Remove a saved sub-agent',
	input: '*scope:String, projectid:String, *name:String',
	action: async function($, model) {

		if (['global', 'project'].indexOf(model.scope) === -1) {
			$.invalid(400);
			return;
		}

		var existed = await new Promise(resolve => MODS.agents.remove(model.scope, model.projectid, model.name, resolve));

		if (!existed)
			$.invalid(404);
		else
			$.success();
	}
});
