// Settings per workspace. The file config holds the defaults of the application; a value can be changed for all of Totem, for one project or for one
// session (a worktree is a session), and the changes are kept in the NoSQL database of Totem (settings), linked to the id of the project or of the
// session. They are not written to the repository and they travel with the data folder. Nothing is read from the environment.
// The order: config < global < project < session. Only the keys listed here can be changed from Totem: the secrets, the address of the server and the
// settings that start a program (terminalshell, forgemcp, forgeurl) belong to config alone.

exports.id = 'settings';

var EDITABLE = ['temperature', 'ollamactx', 'ollamactxmax', 'ollamarepeat', 'ollamapredict', 'ollamapredictsmall', 'maxsteps', 'bashtimeout', 'maxoutput', 'contextlimit', 'retries', 'retrybase', 'totaljs', 'forge', 'recipes', 'reciperesults', 'forgepages', 'forgechars', 'forgedocs', 'selfcheck', 'selfchecksmall', 'conventions', 'formatter', 'diagnostics'];
var ENUMS = { totaljs: ['auto', 'always', 'never'] };
var RANGES = { temperature: [0, 2], ollamactx: [2048, 1048576], ollamactxmax: [2048, 1048576], ollamarepeat: [0, 2], ollamapredict: [0, 131072], ollamapredictsmall: [0, 131072], maxsteps: [1, 500], bashtimeout: [1000, 3600000], maxoutput: [1000, 1000000], contextlimit: [1000, 2000000], retries: [0, 10], retrybase: [0, 60000], reciperesults: [0, 5], forgepages: [0, 6], forgechars: [500, 20000] };
var DEFS = null;

MAIN.settings = MAIN.settings || {};

// The keys that can be changed, with the type, the default and the comment of the config file: [{ key, type, default, comment, options, min, max }]
exports.defs = function() {

	if (DEFS)
		return DEFS;

	DEFS = [];

	var comment = [];
	var text = '';

	try {
		text = Total.Fs.readFileSync(PATH.root('config'), 'utf8');
	} catch (e) {}

	text.split('\n').forEach(function(line) {

		if (/^\/\//.test(line)) {
			comment.push(line.replace(/^\/\/\s?/, '').trim());
			return;
		}

		var match = line.match(/^([a-z0-9]+)\s*(?:\((\w+)\))?\s*:\s*(.*)$/i);

		if (match && EDITABLE.indexOf(match[1]) !== -1) {

			var key = match[1];
			var type = (match[2] || '').toLowerCase();
			var value = match[3].trim();

			if (!type)
				type = ENUMS[key] ? 'enum' : (value === 'true' || value === 'false' ? 'boolean' : 'string');

			DEFS.push({ key: key, type: type, default: CONF[key] == null ? '' : CONF[key], comment: comment.join(' '), options: ENUMS[key] || null, min: RANGES[key] ? RANGES[key][0] : null, max: RANGES[key] ? RANGES[key][1] : null });
		}

		comment = [];
	});

	return DEFS;
};

exports.def = function(key) {
	return exports.defs().findItem('key', key);
};

// { value } or { error }
exports.coerce = function(def, raw) {

	if (def.type === 'boolean') {
		if (raw === true || raw === 'true')
			return { value: true };
		if (raw === false || raw === 'false')
			return { value: false };
		return { error: '@(Use true or false)' };
	}

	if (def.type === 'enum') {
		raw = String(raw);
		return def.options.indexOf(raw) === -1 ? { error: '@(Choose one of: {0})'.format(def.options.join(', ')) } : { value: raw };
	}

	if (def.type === 'number') {
		var number = Number(raw);
		if (raw === '' || raw === null || !isFinite(number))
			return { error: '@(Use a number)' };
		if ((def.min != null && number < def.min) || (def.max != null && number > def.max))
			return { error: '@(Between {0} and {1})'.format(def.min, def.max) };
		return { value: number };
	}

	return { value: String(raw) };
};

function scopeid(scope, id) {
	return scope === 'global' ? 'global' : scope + ':' + id;
}

exports.scopeid = scopeid;

// Loads the saved values at the start
exports.load = function(callback) {
	NOSQL('settings').find().callback(function(err, items) {
		MAIN.settings = {};
		(items || []).forEach(item => MAIN.settings[item.id] = item.values || {});
		callback && callback();
	});
};

// The configuration for a run: the values of config, and over them the ones of the global scope, the project and the session. Reading a key that
// nobody changed gives the value of CONF.
exports.view = function(projectid, sessionid) {

	var conf = Object.create(CONF);

	['global', projectid ? 'project:' + projectid : '', sessionid ? 'session:' + sessionid : ''].forEach(function(id) {
		var values = id && MAIN.settings[id];
		for (var key in values)
			conf[key] = values[key];
	});

	return conf;
};

// For the screen: every key with its value in this scope, the effective one and the layer it comes from
exports.read = function(scope, id, projectid) {

	var own = MAIN.settings[scopeid(scope, id)] || {};
	var layers = [['global', 'global']];

	// The layers above the chosen scope are shown as the inherited value
	if (scope === 'project' || scope === 'session')
		layers.push(['project', 'project:' + (scope === 'project' ? id : projectid)]);

	return exports.defs().map(function(def) {

		var inherited = def.default;
		var layer = 'config';

		layers.forEach(function(item) {
			var values = MAIN.settings[item[1]];
			if (item[1] !== scopeid(scope, id) && values && values[def.key] !== undefined) {
				inherited = values[def.key];
				layer = item[0];
			}
		});

		var changed = own[def.key] !== undefined;
		return Object.assign({}, def, { value: changed ? own[def.key] : inherited, inherited: inherited, from: changed ? scope : layer, changed: changed });
	});
};

// value === undefined removes the value of the scope (it goes back to the one below)
exports.set = function(scope, id, key, value, callback) {

	var docid = scopeid(scope, id);
	var values = Object.assign({}, MAIN.settings[docid] || {});

	if (value === undefined)
		delete values[key];
	else
		values[key] = value;

	if (Object.keys(values).length)
		MAIN.settings[docid] = values;
	else
		delete MAIN.settings[docid];

	var db = NOSQL('settings');

	// The document is small: it is replaced
	db.remove().where('id', docid).callback(function() {
		if (MAIN.settings[docid])
			db.insert({ id: docid, values: values, dtupdated: NOW }).callback(() => callback && callback());
		else
			callback && callback();
	});
};

// The configuration of what runs: a run or a user of a tool (they carry the project and the session), or CONF alone
exports.of = function(source) {
	if (!source)
		return CONF;
	return source.conf || (source.projectid || source.sessionid ? exports.view(source.projectid, source.sessionid) : CONF);
};

// A project or a session is gone: so are its values
exports.clear = function(scope, ids, callback) {
	ids = Array.isArray(ids) ? ids : [ids];
	var docs = ids.map(id => scopeid(scope, id));
	docs.forEach(docid => delete MAIN.settings[docid]);
	NOSQL('settings').remove().in('id', docs).callback(() => callback && callback());
};
