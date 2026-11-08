// Instructions of a project (AGENTS.md) and its skills (folders with SKILL.md), read from the project root.

exports.id = 'instructions';

var SKILLS = ['.totem/skills', '.claude/skills', '.agents/skills', 'skills'];
var MAXTEXT = 20000;
var MAXFILES = 20;
var SKIPDIRS = { node_modules: 1, '.git': 1, databases: 1, tmp: 1 };

function read(path) {
	try {
		return Total.Fs.readFileSync(path, 'utf8');
	} catch (e) {
		return '';
	}
}

function frontmatter(text) {
	var match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	var meta = {};
	if (match) {
		for (var line of match[1].split('\n')) {
			var index = line.indexOf(':');
			if (index > 0)
				meta[line.substring(0, index).trim()] = line.substring(index + 1).trim();
		}
	}
	return { meta: meta, body: match ? text.substring(match[0].length) : text };
}

exports.frontmatter = frontmatter;

// Files that show a project of another kind
var OTHER = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'Gemfile', 'composer.json', 'mix.exs', 'Package.swift', 'CMakeLists.txt'];

// Totem writes Total.js unless the project is clearly something else. With `totaljs : auto` in the config a project is a Total.js project
// when its package.json depends on total5, or when the folder is new (it has no package.json and no file of another kind of project).
// `always` and `never` decide for every project.
exports.istotaljs = function(root, conf) {

	var mode = (conf || CONF).totaljs || 'auto';

	if (mode === 'never')
		return false;

	if (mode === 'always')
		return true;

	var json = null;

	try {
		json = JSON.parse(Total.Fs.readFileSync(Total.Path.join(root, 'package.json'), 'utf8'));
	} catch (e) {}

	if (json)
		return !!((json.dependencies && json.dependencies.total5) || (json.devDependencies && json.devDependencies.total5));

	var names = [];

	try {
		names = Total.Fs.readdirSync(root);
	} catch (e) {}

	return !names.some(name => OTHER.indexOf(name) !== -1 || /\.(csproj|sln)$/.test(name));
};

// The primer of Total.js that goes into the system prompt of a Total.js project
exports.primer = function() {
	return MAIN.primer || '';
};

// More instruction files, chosen by the project in .totem/instructions.json: a list of paths or patterns relative to the root
// (["docs/*.md", "CONTRIBUTING.md"]). Only files inside the project are read; there are no URLs, Totem does not fetch anything by itself.
function extra(root) {

	var list;

	try {
		list = JSON.parse(read(Total.Path.join(root, '.totem/instructions.json')) || '[]');
	} catch (e) {
		return [];
	}

	if (!Array.isArray(list))
		return [];

	var found = [];

	for (var item of list.filter(item => typeof(item) === 'string' && item && item.indexOf('://') === -1)) {

		if (item.indexOf('*') === -1) {
			found.push(item);
			continue;
		}

		var test = FUNC.glob(item);
		var queue = [''];

		while (queue.length && found.length < MAXFILES) {
			var base = queue.shift();
			var names;
			try {
				names = Total.Fs.readdirSync(Total.Path.join(root, base), { withFileTypes: true });
			} catch (e) {
				continue;
			}
			for (var entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
				var relative = base ? (base + '/' + entry.name) : entry.name;
				if (entry.isDirectory()) {
					if (!SKIPDIRS[entry.name])
						queue.push(relative);
				} else if (test.test(relative))
					found.push(relative);
			}
		}
	}

	return found.filter((path, index) => found.indexOf(path) === index && FUNC.resolve(root, path)).slice(0, MAXFILES);
}

exports.extra = extra;

exports.text = function(root) {

	var text = read(Total.Path.join(root, 'AGENTS.md')) || read(Total.Path.join(root, 'CLAUDE.md'));

	for (var path of extra(root)) {
		var content = read(FUNC.resolve(root, path));
		if (content)
			text += '\n\n# {0}\n{1}'.format(path, content.length > MAXTEXT ? (content.substring(0, MAXTEXT) + '\n[truncated]') : content);
	}

	return text.length > MAXTEXT * 2 ? (text.substring(0, MAXTEXT * 2) + '\n[truncated]') : text;
};

// [{ name, description, file }]
exports.skills = function(root) {

	var found = {};
	var dirs = SKILLS.map(base => Total.Path.join(root, base));

	// The skills that come with Totem for Total.js projects come last: a skill of the project with the same name wins
	if (exports.istotaljs(root))
		dirs.push(PATH.private('skills'));

	for (var dir of dirs) {
		var names;
		try {
			names = Total.Fs.readdirSync(dir);
		} catch (e) {
			continue;
		}
		for (var name of names) {
			var file = Total.Path.join(dir, name, 'SKILL.md');
			var parsed = frontmatter(read(file));
			if (parsed.meta.name || parsed.body) {
				var id = parsed.meta.name || name;
				if (!found[id])
					found[id] = { name: id, description: parsed.meta.description || '', file: file };
			}
		}
	}

	return Object.keys(found).sort().map(key => found[key]);
};

exports.skill = function(root, name) {
	for (var item of exports.skills(root)) {
		if (item.name === name) {
			var body = frontmatter(read(item.file)).body;
			return body.length > MAXTEXT ? (body.substring(0, MAXTEXT) + '\n[truncated]') : body;
		}
	}
	return null;
};
