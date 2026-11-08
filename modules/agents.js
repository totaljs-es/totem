// Definitions of sub-agents: a name, a description, the tools they may use, a step limit, optionally their own model, and a prompt.
// Four places, the last one wins: built in (private/agents/*.md), saved from Totem for all projects, saved from Totem for one project (both in the NoSQL
// database `agents`, linked to the id, never in the repository), and the files of the project (.totem/agents/*.md), which travel with the code.

exports.id = 'agents';

MAIN.agentsdb = MAIN.agentsdb || {};

var NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

function words(text) {
	return (text || '').split(',').map(t => t.trim()).filter(Boolean);
}

function definition(source, data) {
	return {
		name: data.name,
		description: data.description || '',
		tools: (data.tools && data.tools.length ? data.tools : ['read', 'glob', 'grep']),
		allow: data.allow || [],
		deny: data.deny || [],
		maxsteps: parseInt(data.maxsteps) || 20,
		model: data.model || '',
		prompt: (data.prompt || '').trim(),
		source: source
	};
}

function load(dir, found, source) {

	var names;
	try {
		names = Total.Fs.readdirSync(dir);
	} catch (e) {
		return;
	}

	for (var file of names) {

		if (!/\.md$/.test(file))
			continue;

		var parsed = MODS.instructions.frontmatter(Total.Fs.readFileSync(Total.Path.join(dir, file), 'utf8'));
		var name = parsed.meta.name || file.replace(/\.md$/, '');

		found[name] = definition(source, { name: name, description: parsed.meta.description, tools: words(parsed.meta.tools || 'read, glob, grep'), allow: words(parsed.meta.allow), deny: words(parsed.meta.deny), maxsteps: parsed.meta.maxsteps, model: parsed.meta.model, prompt: parsed.body });
	}
}

// Loads the saved agents at the start
exports.load = function(callback) {
	NOSQL('agents').find().callback(function(err, items) {
		MAIN.agentsdb = {};
		(items || []).forEach(item => MAIN.agentsdb[item.id] = item);
		callback && callback();
	});
};

exports.validname = function(name) {
	return NAME.test(name || '');
};

exports.list = function(root, projectid) {

	var found = {};

	load(PATH.private('agents'), found, 'built-in');

	var saved = Object.keys(MAIN.agentsdb).map(key => MAIN.agentsdb[key]);

	saved.filter(item => item.scope === 'global').forEach(item => found[item.name] = definition('all projects', item));

	if (projectid)
		saved.filter(item => item.scope === 'project' && item.projectid === projectid).forEach(item => found[item.name] = definition('project', item));

	if (root)
		load(Total.Path.join(root, '.totem/agents'), found, 'file');

	return Object.keys(found).sort().map(key => found[key]);
};

exports.get = function(root, name, projectid) {
	return exports.list(root, projectid).findItem('name', name);
};

function docid(scope, projectid, name) {
	return scope === 'global' ? 'global:' + name : 'project:' + projectid + ':' + name;
}

// data: { scope, projectid, name, description, tools, allow, deny, maxsteps, model, prompt }
exports.save = function(data, callback) {

	var doc = { id: docid(data.scope, data.projectid, data.name), scope: data.scope, projectid: data.scope === 'project' ? data.projectid : '', name: data.name, description: data.description || '', tools: data.tools || [], allow: data.allow || [], deny: data.deny || [], maxsteps: data.maxsteps || 20, model: data.model || '', prompt: data.prompt || '', dtupdated: NOW };
	MAIN.agentsdb[doc.id] = doc;

	// The document is small: it is replaced
	NOSQL('agents').remove().where('id', doc.id).callback(() => NOSQL('agents').insert(doc).callback(() => callback && callback()));
};

exports.remove = function(scope, projectid, name, callback) {
	var id = docid(scope, projectid, name);
	var existed = !!MAIN.agentsdb[id];
	delete MAIN.agentsdb[id];
	NOSQL('agents').remove().where('id', id).callback(() => callback && callback(existed));
};

// A project is gone: so are its agents
exports.clear = function(projectid, callback) {
	Object.keys(MAIN.agentsdb).forEach(key => MAIN.agentsdb[key].projectid === projectid && MAIN.agentsdb[key].scope === 'project' && delete MAIN.agentsdb[key]);
	NOSQL('agents').remove().where('projectid', projectid).where('scope', 'project').callback(() => callback && callback());
};
