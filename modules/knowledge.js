// The knowledge that Totem puts in front of the model for the request of the user: first its own recipes (private/recipes, short and exact, they
// work without a connection), then the documentation of Forge.
//
// The documentation of Forge for the request of the user. When the Forge server is connected, its search runs with the text of the
// prompt and the best pages are read and kept for the system prompt. A small model does not call tools well, but it writes well
// from a page that is already in front of it. The pages are shown in the conversation, so the user sees what was used.

exports.id = 'knowledge';

var MINLENGTH = 12;

// The recipes of Totem for Total.js 5 (private/recipes/*.md): a title, the words that call for it and a short text with code that follows our conventions.
// A small model copies what it has in front of it, so the recipe of the task is put there. Only in projects that depend on total5.
var RECIPES = null;

function frontmatter(text) {
	var match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	var meta = {};
	if (!match)
		return { meta: meta, body: text };
	match[1].split('\n').forEach(function(line) {
		var index = line.indexOf(':');
		if (index !== -1)
			meta[line.substring(0, index).trim()] = line.substring(index + 1).trim();
	});
	return { meta: meta, body: match[2].trim() };
}

function loadrecipes() {

	if (RECIPES)
		return RECIPES;

	RECIPES = [];

	try {
		var dir = PATH.private('recipes');
		Total.Fs.readdirSync(dir).sort().forEach(function(name) {
			if (!/\.md$/.test(name))
				return;
			var parsed = frontmatter(Total.Fs.readFileSync(Total.Path.join(dir, name), 'utf8'));
			var list = text => (text || '').toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
			RECIPES.push({ id: name.replace(/\.md$/, ''), title: parsed.meta.title || name, keywords: list(parsed.meta.keywords), strong: list(parsed.meta.strong), body: parsed.body });
		});
	} catch (e) {}

	return RECIPES;
}

// The recipes for a text, the best first: [{ id, title, body }]
exports.recipes = function(text, max) {

	var words = {};
	(text || '').toLowerCase().replace(/[^a-z0-9áéíóúñü._-]+/g, ' ').split(' ').forEach(function(word) {
		if (word.length > 1)
			words[word.replace(/^[._-]+|[._-]+$/g, '')] = 1;
	});

	var lower = (text || '').toLowerCase();

	return loadrecipes().map(function(recipe) {
		var score = 0;
		var hit = keyword => words[keyword] || (/[._-]/.test(keyword) && lower.indexOf(keyword) !== -1);
		// A word of the topic itself counts three, a word that goes with it one: two of those are needed, one of the first is enough
		recipe.strong.forEach(keyword => hit(keyword) && (score += 3));
		recipe.keywords.forEach(keyword => hit(keyword) && recipe.strong.indexOf(keyword) === -1 && score++);
		return { recipe: recipe, score: score };
	}).filter(item => item.score >= 2).sort((a, b) => b.score - a.score).slice(0, max == null ? 2 : max).map(item => item.recipe);
};


// Words that say nothing about the topic, in Spanish and English: the search of Forge works with words
var STOP = ('quiero quisiera necesito puedo puedes hacer haz crear crea escribe escribir un una unos unas el la los las de del en con para por como cual que y o a al lo es me mi tu su se no si ' +
	'i want would like need make write create build the an and or to of in on for with how do does can could you please my me is are it this that there some a').split(' ').reduce((map, word) => (map[word] = 1, map), {});

// The pages of Forge are in English: the words of the topic that people write in Spanish are translated
var ES = { componente: 'component', componentes: 'component', formulario: 'form', formularios: 'form', ruta: 'route', rutas: 'route', 'acción': 'action', accion: 'action', esquema: 'schema', pantalla: 'page', 'botón': 'button', boton: 'button', tabla: 'table', lista: 'list', vista: 'view', vistas: 'view', 'validación': 'validation', 'autenticación': 'authentication', 'sesión': 'session', archivo: 'file', archivos: 'file', subir: 'upload', estilos: 'css', 'diseño': 'design' };

// The pages of Forge still write some action names with a slash (Products/query). The conventions of Total.js 5 use a pipe (Products|query), and a small
// model copies what it reads: the text of a page is put right before it goes to the model.
function conventions(text) {
	return (text || '')
		.replace(/(NEW(?:ACTION|SCHEMA)\(\s*')(@?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)+)(')/g, (all, a, name, b) => a + name.split('/').join('|') + b)
		.replace(/(-->\s*)(@?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)+)/g, (all, a, name) => a + name.split('/').join('|'));
}

exports.conventions = conventions;

// The words of the prompt that matter, and the product of Forge that the prompt is about
function route(text) {

	var words = text.toLowerCase().replace(/[^a-z0-9áéíóúñü._-]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP[word]).map(word => ES[word] || word);
	var product = '';

	// Someone who wants to make a component is looking for the recipe that writes one
	if (words.indexOf('component') !== -1 && /\b(hacer|haz|crear|crea|escribe|escribir|make|create|write|build|new|nuevo|nueva)\b/i.test(text) && words.indexOf('custom') === -1)
		words.unshift('custom');

	if (/jcomponent|ui-component|ui-bind|\bcomponent\(|\bcomponentator|\bplugin\(|tangular/i.test(text))
		product = 'jcomponent';
	else if (/total\.?js|total5|newaction|newschema|\broute\(|\bdata\.|nosql|filestorage|restbuilder|schema/i.test(text))
		product = 'total5';

	return { query: (words.join(' ') || text).substring(0, 200), product: product };
}

exports.route = route;

function parse(text) {
	try {
		return JSON.parse(text);
	} catch (e) {
		return null;
	}
}

// callback([{ title, url }]) with the pages that were added to run.knowledge (an empty list when there is nothing to add)
exports.prefetch = function(run, text, callback_) {

	var pages = CONF.forgepages == null ? 2 : CONF.forgepages;

	run.knowledge = '';
	run.recipeids = [];

	// A command is a fixed instruction: it has nothing to look up
	if (run.command) {
		callback_([]);
		return;
	}

	// The recipes of Totem, for a request about Total.js 5 (not for a slash command)
	var mine = [];

	if (CONF.recipes !== false && (text || '').trim().length >= MINLENGTH && !/^\//.test(text.trim()) && MODS.instructions.istotaljs(run.root))
		mine = exports.recipes(text, CONF.reciperesults == null ? 2 : CONF.reciperesults);

	// The recipes that the last turn showed are already in the conversation: showing them again makes a small model answer with the same example
	// whatever the user says next
	mine = mine.filter(r => (run.shown || []).indexOf(r.id) === -1);
	run.recipeids = mine.map(r => r.id);

	var recipetext = mine.length ? ('Recipes of Totem for this request. Follow them exactly: names, style and the way each thing is answered. Do not add anything that is not needed (no user interface for a server question).\n\n' + mine.map(r => '### ' + r.title + '\n' + r.body).join('\n\n')) : '';
	var listed = mine.map(r => ({ title: r.title, url: '' }));

	run.knowledge = recipetext;

	var callback = (function(original) {
		return function(found) {
			original(listed.concat(found || []));
		};
	})(callback_);

	if (!pages || !run.mcp || !run.mcp.tools.forge__Forge_search || !run.mcp.tools.forge__Forge_page || (text || '').trim().length < MINLENGTH || /^\//.test(text.trim())) {
		callback([]);
		return;
	}

	var asked = route(text.trim());

	function search(input, next) {
		MODS.mcpclient.call(run, 'forge__Forge_search', { input: input }, function(err, output) {
			var json = err ? null : parse(output);
			next((json && json.results) || []);
		}, 8000);
	}

	var input = { query: asked.query, limit: 6 };

	if (asked.product)
		input.product = asked.product;

	search(input, function(results) {

		// A search that is limited to a product and finds nothing is repeated without the limit
		if (!results.length && asked.product) {
			delete input.product;
			search(input, next);
			return;
		}

		next(results);
	});

	function next(results) {

		if (!results.length) {
			callback([]);
			return;
		}

		var chosen = results.slice(0, pages);
		var found = [];
		var blocks = [];

		chosen.wait(function(item, next) {

			MODS.mcpclient.call(run, 'forge__Forge_page', { input: { section: item.section, slug: item.slug, max_chars: CONF.forgechars || 3500 } }, function(err, content) {

				var page = err ? null : parse(content);

				if (page && page.markdown) {
					found.push({ title: item.title, url: item.url || page.url || '' });
					blocks.push('### {0} ({1})\n{2}'.format(item.title, item.url || page.url || '', conventions(page.markdown)));
				}

				next();
			}, 8000);

		}, function() {

			if (!blocks.length) {
				callback([]);
				return;
			}

			// The other results of the search are listed, so that the model can read them with the page tool
			var more = results.slice(pages).map(r => '- {0} ({1} {2}): {3}'.format(r.title, r.section, r.slug, (r.description || '').substring(0, 120)));

			run.knowledge = (recipetext ? (recipetext + '\n\n') : '') + 'Pages of Forge (https://forge.totaljs.es) that match the request of the user. Follow them: they are the documentation of Total.js 5 and jComponent 20.\n\n' + blocks.join('\n\n') + (more.length ? ('\n\nOther pages that may help (read one with forge__Forge_page, arguments { input: { section, slug } }):\n' + more.join('\n')) : '');

			callback(found);
		});
	}
};
