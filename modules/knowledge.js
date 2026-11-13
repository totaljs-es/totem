// The knowledge that Totem puts in front of the model for the request of the user: first its own recipes (private/recipes, short and exact, they
// work without a connection), then the documentation of Forge: its llms.txt (the index of every page, in plain text) and the pages in Markdown,
// read with a plain GET, with no MCP server and no permission to ask. The search runs here, so the prompt never leaves this computer. The MCP
// server of Forge is the fallback when the documents are not available.
//
// The documentation of Forge for the request of the user. When the Forge server is connected, its search runs with the text of the
// prompt and the best pages are read and kept for the system prompt. A small model does not call tools well, but it writes well
// from a page that is already in front of it. The pages are shown in the conversation, so the user sees what was used.

exports.id = 'knowledge';

var MINLENGTH = 12;
var APPREQUEST = /^\s*(?:(?:quiero|necesito)\s+)?(?:crea|crear|cr[eé]ame|haz|hacer|create|build|make)\s+(?:(?:una?|an?|me|new|nueva?|m[ií]nima?|minimal|simple|basic|b[aá]sica?|peque[ñn]a?|small|total\.?js|total5|5|api)\s+){0,8}(?:aplicaci[oó]n|application|app)\b/i;

exports.apprequest = function(text) {
	return APPREQUEST.test(text || '');
};

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

function stems(words, stem) {
	for (var word in words) {
		if (word.indexOf(stem) === 0)
			return true;
	}
	return false;
}

// The recipes for a text, the best first: [{ id, title, body }]
exports.recipes = function(text, max) {

	var words = {};
	(text || '').toLowerCase().replace(/[^a-z0-9áéíóúñü._-]+/g, ' ').split(' ').forEach(function(word) {
		if (word.length > 1)
			words[word.replace(/^[._-]+|[._-]+$/g, '')] = 1;
	});

	var lower = (text || '').toLowerCase();
	var newapp = exports.apprequest(text);
	var togglecard = /tarjeta|card|mensaje|message/.test(lower) && /ocult|mostrar|muestre|toggle|hide|show/.test(lower) && /component|jcomponent/.test(lower);
	var fullhtml = /\bhtml\b/.test(lower) && /complet|standalone|entero|full|p[aá]gina/.test(lower);
	// A component of Flow is not a jComponent: its recipe goes first and the one of jComponent does not go at all
	var flowcomponent = /\bflow(stream)?\b/.test(lower) && /component|komponent/.test(lower);

	return loadrecipes().map(function(recipe) {
		var score = 0;
		// A keyword that ends with * is a stem (autentic* is autenticar, autenticados, autenticación...)
		var hit = keyword => keyword.slice(-1) === '*' ? stems(words, keyword.slice(0, -1)) : (words[keyword] || (/[._-]/.test(keyword) && lower.indexOf(keyword) !== -1));
		// A word of the topic itself counts three, a word that goes with it one: two of those are needed, one of the first is enough
		recipe.strong.forEach(keyword => hit(keyword) && (score += 3));
		recipe.keywords.forEach(keyword => hit(keyword) && recipe.strong.indexOf(keyword) === -1 && score++);
		if (newapp && recipe.id === 'new-app')
			score += 50;
		if (togglecard && recipe.id === 'toggle-card')
			score += 30;
		if (fullhtml && recipe.id === 'html-page')
			score += 20;
		if (flowcomponent && recipe.id === 'flow-component')
			score += 50;
		if (flowcomponent && (recipe.id === 'component' || recipe.id === 'toggle-card'))
			score = 0;
		return { recipe: recipe, score: score };
	}).filter(item => item.score >= 2).sort((a, b) => b.score - a.score).slice(0, max == null ? 2 : max).map(item => item.recipe);
};


// Words that say nothing about the topic, in Spanish and English: the search of Forge works with words
var STOP = ('quiero quisiera necesito puedo puedes hacer haz crear crea escribe escribir un una unos unas el la los las de del en con para por como cual que y o a al lo es me mi tu su se no si ' +
	'i want would like need make write create build the an and or to of in on for with how do does can could you please my me is are it this that there some a').split(' ').reduce((map, word) => (map[word] = 1, map), {});

// The same by the start of the word: the Spanish of the topic in any form (autenticados, protejo, usuarios...)
var ESSTEM = [['autentic', 'authentication'], ['proteg', 'protect'], ['protej', 'protect'], ['usuari', 'user'], ['sesi', 'session'], ['permis', 'permission'], ['contrase', 'password'], ['archiv', 'file'], ['descarg', 'download'], ['correo', 'email'], ['notific', 'notification'], ['formular', 'form'], ['cifr', 'encrypt'], ['encript', 'encrypt'], ['tarea', 'job'], ['programad', 'schedule'], ['validac', 'validation'], ['valida', 'validate'], ['lectur', 'read'], ['imagen', 'image'], ['busca', 'search'], ['paginac', 'pagination'], ['cach', 'cache'], ['traduc', 'translate'], ['idioma', 'language'], ['envi', 'send'], ['enví', 'send'], ['estátic', 'static'], ['estatic', 'static'], ['sirv', 'serve'], ['petici', 'request'], ['descifr', 'decrypt'], ['gráfic', 'chart'], ['grafic', 'chart'], ['barra', 'bar'], ['calendari', 'calendar'], ['desplegable', 'dropdown'], ['ventana', 'window'], ['pestañ', 'tab'], ['menú', 'menu'], ['mapa', 'map'], ['casilla', 'checkbox'], ['selecc', 'select'], ['icono', 'icon'], ['subo', 'upload'], ['sube', 'upload'], ['subid', 'upload'], ['ejecut', 'run'], ['minuto', 'minute'], ['hora', 'hour'], ['listado', 'list'], ['arrastr', 'drag'], ['orden', 'sort'], ['filtr', 'filter'], ['firma', 'signature'], ['confirm', 'confirm'], ['borr', 'remove'], ['elimin', 'remove'], ['guarda', 'save'], ['guardo', 'save'], ['aviso', 'notify'], ['progres', 'progress'], ['cargand', 'loading'], ['árbol', 'tree'], ['arbol', 'tree'], ['etiquet', 'tag'], ['vídeo', 'video'], ['plantill', 'template']];

function stemof(word) {
	for (var i = 0; i < ESSTEM.length; i++) {
		if (word.indexOf(ESSTEM[i][0]) === 0)
			return ESSTEM[i][1];
	}
	return '';
}

// The pages of Forge are in English: the words of the topic that people write in Spanish are translated
var ES = { componente: 'component', componentes: 'component', formulario: 'form', formularios: 'form', ruta: 'route', rutas: 'route', 'acción': 'action', accion: 'action', esquema: 'schema', pantalla: 'page', 'botón': 'button', boton: 'button', tabla: 'table', lista: 'list', vista: 'view', vistas: 'view', 'validación': 'validation', 'autenticación': 'authentication', 'sesión': 'session', archivo: 'file', archivos: 'file', subir: 'upload', estilos: 'css', 'diseño': 'design', memoria: 'memory', sistema: 'system', libre: 'free', usuario: 'user', usuarios: 'user', 'contraseña': 'password', correo: 'email', fecha: 'date', 'configuración': 'config', configuracion: 'config', 'servidor': 'server', 'base': 'database' };

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

	var words = text.toLowerCase().replace(/[^a-z0-9áéíóúñü._-]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP[word]).map(word => ES[word] || stemof(word) || word);
	var product = '';

	// Someone who wants to make a component is looking for the recipe that writes one
	if (words.indexOf('component') !== -1 && /\b(hacer|haz|crear|crea|escribe|escribir|make|create|write|build|new|nuevo|nueva)\b/i.test(text) && words.indexOf('custom') === -1)
		words.unshift('custom');

	if (/jcomponent|ui-component|ui-bind|\bcomponent\(|\bcomponentator|\bplugin\(|\bhtml\b|\bfrontend\b|\binterfaz\b|\bcomponent(?:e|es|s)?\b/i.test(text) && !/server component|componente (?:del? )?servidor/i.test(text))
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

// The index of Forge (llms.txt): every page with its title, its address in Markdown and its description, kept for a day. Without an answer it is
// tried again after ten minutes.
var INDEXTTL = 24 * 60 * 60 * 1000;
var INDEXRETRY = 10 * 60 * 1000;

function forgeurl() {
	return (CONF.forgeurl || 'https://forge.totaljs.es').replace(/\/+$/, '');
}

function parseindex(text) {

	var items = [];
	var section = '';

	(text || '').split('\n').forEach(function(line) {

		var head = line.match(/^## (.+)$/);

		if (head) {
			section = head[1].trim();
			return;
		}

		var match = line.match(/^- \[([^\]]+)\]\((https?:\/\/[^)\s]+\.md)\)(?::\s*(.*))?$/);

		if (match)
			items.push({ section: section, title: match[1], url: match[2], description: match[3] || '' });
	});

	return items;
}

exports.parseindex = parseindex;

function get(url, callback) {
	RESTBuilder.GET(url).text().timeout(8000).maxlength(3 * 1024 * 1024).exec(function(err, response, output) {
		callback(err || !output || output.status >= 400 || typeof(response) !== 'string' ? null : response);
	});
}

// The metadata of knowledge.json (the API names and tags of each document) joined to the items of the index by section/slug. A name that appears in
// many documents (GET, JSON, Total.js) says nothing about one of them, so only the names of a few documents are kept.
var COMMONSYMBOL = 40;

function addmeta(items, text) {

	var json = parse(text);
	var documents = json && Array.isArray(json.documents) ? json.documents : [];

	if (!documents.length)
		return;

	var frequency = {};
	var map = {};

	documents.forEach(function(doc) {
		(doc.symbols || []).forEach(function(name) {
			name = String(name).toLowerCase();
			frequency[name] = (frequency[name] || 0) + 1;
		});
		map[doc.section + '/' + doc.slug] = doc;
	});

	items.forEach(function(item) {
		var match = item.url.match(/\/([a-z0-9-]+)\/([^\/]+)\.md$/i);
		var doc = match && map[match[1] + '/' + match[2]];
		if (!doc)
			return;
		item.symbols = (doc.symbols || []).map(name => String(name).toLowerCase()).filter(name => frequency[name] <= COMMONSYMBOL);
		item.tags = (doc.tags || []).map(tag => String(tag).toLowerCase());
	});
}

exports.addmeta = addmeta;

// callback(items): an empty list when the index is not available
function loadindex(callback) {

	var cache = MAIN.forgeindex;

	if (cache && cache.until > Date.now()) {
		callback(cache.items);
		return;
	}

	get(forgeurl() + '/llms.txt', function(text) {
		var items = text ? parseindex(text) : [];
		var done = function() {
			MAIN.forgeindex = { items: items, until: Date.now() + (items.length ? INDEXTTL : INDEXRETRY) };
			callback(items);
		};
		// The metadata is an extra: without it the pages are ranked by title, address and description as before
		if (!items.length)
			return done();
		get(forgeurl() + '/knowledge.json', function(meta) {
			meta && addmeta(items, meta);
			done();
		});
	});
}

exports.loadindex = loadindex;

// The library of Totem: the repository of Total.js knowledge (conventions, answers, questions and tested applications), read live from its llms.txt,
// which has the shape of the index of Forge. A change of a page there reaches Totem in a day, with no new version and no training.
function libraryurl() {
	return (CONF.libraryurl || 'https://raw.githubusercontent.com/totaljs-es/knowledge/main').replace(/\/+$/, '');
}

// The questions in other languages have the same code as the English ones: one copy is enough for the model
var LIBRARYSKIP = /^Questions in /i;

// callback(items): an empty list when the index is not available
function loadlibrary(callback) {

	var cache = MAIN.libraryindex;

	if (cache && cache.until > Date.now()) {
		callback(cache.items);
		return;
	}

	get(libraryurl() + '/llms.txt', function(text) {
		var items = (text ? parseindex(text) : []).filter(item => !LIBRARYSKIP.test(item.section));
		items.forEach(function(item) {
			item.library = true;
		});
		var done = function() {
			MAIN.libraryindex = { items: items, until: Date.now() + (items.length ? INDEXTTL : INDEXRETRY) };
			callback(items);
		};
		// The metadata is an extra: without it the pages are ranked by title, address and description
		if (!items.length)
			return done();
		get(libraryurl() + '/knowledge.json', function(meta) {
			meta && addlibrarymeta(items, meta, libraryurl());
			done();
		});
	});
}

exports.loadlibrary = loadlibrary;

// knowledge.json of the library: the API names and the words of the headings of each page, joined to the items of the index by the file of the page
function addlibrarymeta(items, text, base) {

	var json = parse(text);
	var documents = json && Array.isArray(json.documents) ? json.documents : [];
	var map = {};

	documents.forEach(function(doc) {
		map[doc.file] = doc;
	});

	items.forEach(function(item) {
		var doc = map[item.url.indexOf(base + '/') === 0 ? item.url.substring(base.length + 1) : ''];
		if (!doc)
			return;
		item.symbols = (doc.symbols || []).map(name => String(name).toLowerCase());
		item.tags = (doc.tags || []).map(tag => String(tag).toLowerCase());
	});
}

exports.addlibrarymeta = addlibrarymeta;

// The questions and answers of the library one by one. A small model answers right with the one answer that matches the question in front of it,
// and is lost with a whole page of answers to similar questions: the search finds the answer, not the page. The questions are in English,
// Spanish and Slovak in the same order, so the same answer in each language has the same key.
var ANSWERSECTIONS = /^(Questions|Questions in [A-Za-z]+|Answers)$/i;

// Words that say nothing about the topic, in English, Spanish and Slovak, without accents
var QSTOP = ('the a an and or to of in on for with how do does did i my me is are am it its this that these what which can could should would will when where who why be by from as at your you we our us use using want need get make write give show tell there here then than so not no yes just about into one some any all ' +
	'el la los las un una unos unas de del en con para por como que y o a al lo es mi mis tu tus su sus se no si hay cual donde cuando quien hola buenas oye duda pregunta quiero quisiera puedo puedes hago hacer tengo debo uso usar ese esa este esta esto eso me te le nos les ya muy mas pero tambien sobre entre algo alguna alguno todo toda ' +
	'v na sa ako je to s z do pre co ktory ktora ktore mam mozem chcem som aj alebo ale').split(' ').reduce((map, word) => (map[word] = 1, map), {});

function terms(text) {

	var out = [];

	(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$_.|]+/g, ' ').split(' ').forEach(function(word) {

		word = word.replace(/^[.|]+|[.|]+$/g, '');

		if (!word)
			return;

		// An API name counts whole and by its parts: DATA.modify finds a question that says "modify"
		var parts = /[.|]/.test(word) ? [word].concat(word.split(/[.|]/)) : [word];

		parts.forEach(function(part) {
			if (part.length < 2 || QSTOP[part])
				return;
			// The plural is the singular: routes, records, acciones
			if (part.length > 5 && /ones$/.test(part))
				part = part.substring(0, part.length - 2);
			else if (part.length > 3 && /[^s]s$/.test(part))
				part = part.substring(0, part.length - 1);
			out.push(part);
		});
	});

	return out;
}

exports.terms = terms;

// The answers of one page of the library: every "## question" of a page of questions, or the whole page of an answer
exports.units = function(markdown, page) {

	var text = (markdown || '').replace(/\r/g, '');
	var meta = '';
	var head = text.match(/^---\n([^]*?)\n---\n/);

	if (head) {
		meta = head[1];
		text = text.substring(head[0].length);
	}

	var file = page.url.replace(/^.*\/(questions|answers)\/(?:[a-z]{2}\/)?/, '$1/');
	var units = [];

	if (/^answers\//.test(file)) {
		var title = (text.match(/^# (.+)$/m) || [])[1] || page.title;
		var also = (meta.match(/^question_[a-z]{2}:\s*(.+)$/gm) || []).map(line => line.replace(/^question_[a-z]{2}:\s*/, '')).join(' ');
		units.push({ key: file, title: title.trim(), also: also, body: text.replace(/^# .+\n+/m, '').trim(), url: page.url });
		return units;
	}

	var parts = text.split(/^## (.+)$/m);

	for (var i = 1; i < parts.length; i += 2)
		units.push({ key: file + '#' + ((i - 1) / 2), title: parts[i].trim(), also: '', body: parts[i + 1].trim(), url: page.url });

	return units;
};

// callback(units): the answers of the library, kept for a day like its index (an empty list when it is not available)
function loadquestions(callback) {

	var cache = MAIN.libraryquestions;

	if (cache && cache.until > Date.now()) {
		callback(cache.units);
		return;
	}

	get(libraryurl() + '/llms.txt', function(text) {

		var pages = (text ? parseindex(text) : []).filter(item => ANSWERSECTIONS.test(item.section));
		var units = [];

		pages.wait(function(page, next) {
			get(page.url, function(markdown) {
				markdown && units.push.apply(units, exports.units(markdown, page));
				next();
			});
		}, function() {
			// Other ways of asking each question (questions/asked.json of the library): the words that people use and the question does not
			get(libraryurl() + '/questions/asked.json', function(text) {
				exports.asked(units, text ? parse(text) : null);
				exports.index(units);
				MAIN.libraryquestions = { units: units, until: Date.now() + (units.length ? INDEXTTL : INDEXRETRY) };
				callback(units);
			});
		}, 6);
	});
}

// { "<question in English>": ["another way of asking", ...] } joined to the answer of that question in every language
exports.asked = function(units, map) {

	if (!map || typeof(map) !== 'object')
		return;

	var keys = {};

	units.forEach(function(unit) {
		if (!/\/(es|sk)\//.test(unit.url))
			keys[unit.title] = unit.key;
	});

	var byKey = {};

	Object.keys(map).forEach(function(question) {
		var key = keys[question];
		if (key && Array.isArray(map[question]))
			byKey[key] = map[question].join(' ');
	});

	units.forEach(function(unit) {
		if (byKey[unit.key])
			unit.also = (unit.also + ' ' + byKey[unit.key]).trim();
	});
};

exports.loadquestions = loadquestions;

// The words of each answer, with the words of its question three times: what someone asks is in the question more than in the answer
exports.index = function(units) {

	var df = {};
	var total = 0;

	units.forEach(function(unit) {
		var tf = {};
		var count = 0;
		var add = function(words, weight) {
			words.forEach(function(word) {
				tf[word] = (tf[word] || 0) + weight;
				count += weight;
			});
		};
		add(terms(unit.title + ' ' + unit.also), 3);
		add(terms(unit.body), 1);
		unit.tf = tf;
		unit.length = count;
		total += count;
		Object.keys(tf).forEach(word => df[word] = (df[word] || 0) + 1);
	});

	units.stats = { df: df, n: units.length, avg: units.length ? total / units.length : 1 };
	return units;
};

// The answers that share words with a question, the best first (BM25), each with its score and the part of the question it covers (0 to 1). The
// same answer in another language is the same answer: only the best of them stays.
function scored(units, text) {

	var stats = units.stats;

	if (!stats || !units.length)
		return [];

	var asked = terms(text).filter((word, index, arr) => arr.indexOf(word) === index);
	var known = asked.filter(word => stats.df[word]);

	if (!known.length)
		return [];

	var idf = {};
	var top = 0;

	known.forEach(function(word) {
		idf[word] = Math.log(1 + (stats.n - stats.df[word] + 0.5) / (stats.df[word] + 0.5));
		top += idf[word];
	});

	var K = 1.2;
	var B = 0.75;
	var best = {};

	units.forEach(function(unit) {
		var score = 0;
		var matched = 0;
		known.forEach(function(word) {
			var tf = unit.tf[word];
			if (!tf)
				return;
			matched += idf[word];
			score += idf[word] * (tf * (K + 1)) / (tf + K * (1 - B + B * unit.length / stats.avg));
		});
		if (!score)
			return;
		var key = unit.key;
		if (!best[key] || best[key].score < score)
			best[key] = { unit: unit, score: score, covered: matched / top };
	});

	return Object.keys(best).map(key => best[key]).sort((a, b) => b.score - a.score);
}

// The answers for a question by its words alone. A second answer comes only when it scores almost as the first; nothing comes when the best answer
// shares too little with the question.
exports.answers = function(units, text, max) {
	var list = scored(units, text).filter(entry => entry.covered >= 0.5);
	return list.filter((entry, index) => index === 0 || entry.score >= list[0].score * 0.85).slice(0, max || 2).map(entry => entry.unit);
};

// The answers that may be the right one, for the model to choose among them by their questions
exports.candidates = function(units, text, max) {
	return scored(units, text).slice(0, max || 20).map(entry => entry.unit);
};

// The sections of the index that are not documentation of a product
var NOTDOCS = /^(Start here|Recorded performance benchmarks|Products and versions|Optional|Agent navigation and usage)$/i;

// The pages of the index for the words of the prompt, the best first: a word in the title counts three, in the address two, in the description one
exports.rank = function(items, asked, max) {

	var words = (asked.query || '').split(' ').filter(word => word.length > 2);

	if (!words.length)
		return [];

	var want = null;

	if (asked.product === 'total5')
		want = /^Total\.js 5/i;
	else if (asked.product === 'jcomponent')
		want = /^(jComponent|Components)/i;
	else if (!/\b(openplatform|cms|flow|todomator|uibuilder|ui-builder)\b/.test(asked.query || ''))
		want = /^(Total\.js 5|jComponent|Components)/i;

	var topics = {
		config: /config|\bconf\b/i,
		mods: /module|\bmods\b/i,
		node: /file|filesystem|crypto|node\.js|total\.fs/i,
		style: /style|es5|convention/i,
		'uid-now': /\buid\b|identifier|unique|\bnow\b|dates?/i,
		'api-action': /api|action/i,
		route: /route|routing/i
	};
	var focus = topics[asked.recipe];
	return items.filter(function(item) {
		// Every page of the library is about Total.js 5 or jComponent 20: its sections are zones (Backend, Frontend), not products
		if (NOTDOCS.test(item.section) || (want && !item.library && !want.test(item.section)))
			return false;
		// Flow examples share many generic words with ordinary application settings, files and tests.
		if (!/\bflow(?:stream)?\b/i.test(asked.query || '') && /flowstream|\bflow\b/i.test(item.title + ' ' + item.url))
			return false;
		return !focus || focus.test(item.title + ' ' + item.url);
	}).map(function(item) {
		var title = item.title.toLowerCase();
		var slug = item.url.toLowerCase();
		var description = item.description.toLowerCase();
		var symbols = item.symbols || [];
		var tags = item.tags || [];
		var score = 0;
		var hits = 0;
		var named = false;
		words.forEach(function(word) {
			var hit = 0;
			if (title.indexOf(word) !== -1)
				hit += 3;
			if (slug.indexOf(word) !== -1)
				hit += 2;
			if (description.indexOf(word) !== -1)
				hit++;
			// The API name of the prompt (route, newaction, conf) is the page that documents it; a tag is a weaker sign
			if (symbols.indexOf(word) !== -1) {
				hit += 3;
				named = true;
			}
			if (tags.indexOf(word) !== -1)
				hit += 2;
			score += hit;
			hits += hit ? 1 : 0;
		});
		return { item: item, score: score, hits: hits, named: named };
	// An API name of the request that the page documents is enough by itself (cron, uid, mail)
	}).filter(entry => entry.score >= 3 && (entry.hits >= 2 || words.length === 1 || entry.score >= 8 || entry.named)).sort((a, b) => b.score - a.score || (b.item.library ? 1 : 0) - (a.item.library ? 1 : 0)).slice(0, max).map(entry => entry.item);
};

// The text of a page of Forge without the lines of its header (framework, hashes, snapshot...)
exports.pagebody = function(markdown) {
	return (markdown || '').replace(/^(Framework|Product|Language|Content-SHA256|Snapshot|Sources|Review|Source):.*\n/gm, '').replace(/\n{3,}/g, '\n\n').trim();
};

// The text of a page that fits in max characters and keeps what the request is about. The page is cut in blocks (a paragraph, a list, a whole
// code block, a heading with its first block): the start of the page always stays, then the blocks with the most words of the request, in the
// order of the page. Nothing is cut in the middle of a block of code.
function blocks(markdown) {

	var out = [];
	var current = [];
	var fenced = false;

	function flush() {
		if (current.length) {
			out.push(current.join('\n'));
			current = [];
		}
	}

	markdown.split('\n').forEach(function(line) {
		if (/^\s*```/.test(line)) {
			// An opening fence starts its own block when text is waiting
			if (!fenced && current.length && !/^#{1,6} /.test(current[current.length - 1]))
				flush();
			fenced = !fenced;
			current.push(line);
			if (!fenced)
				flush();
			return;
		}
		if (fenced) {
			current.push(line);
			return;
		}
		if (!line.trim()) {
			flush();
			return;
		}
		// A heading closes the block before it and stays with the block that follows
		if (/^#{1,6} /.test(line) && current.length && !/^#{1,6} /.test(current[current.length - 1]))
			flush();
		current.push(line);
	});

	flush();

	// A heading alone goes with the next block
	var merged = [];
	for (var i = 0; i < out.length; i++) {
		if (/^#{1,6} [^\n]*$/.test(out[i]) && i + 1 < out.length)
			out[i + 1] = out[i] + '\n\n' + out[i + 1];
		else
			merged.push(out[i]);
	}

	// A table or a list longer than a third of the page (the keys of the configuration) is cut by lines, so that its useful rows can be chosen
	var split = [];
	merged.forEach(function(block) {
		// A block with code is never cut
		if (block.length < 1200 || /^\s*```/m.test(block)) {
			split.push(block);
			return;
		}
		var group = [];
		var size = 0;
		block.split('\n').forEach(function(line) {
			group.push(line);
			size += line.length + 1;
			if (size > 700) {
				split.push(group.join('\n'));
				group = [];
				size = 0;
			}
		});
		group.length && split.push(group.join('\n'));
	});

	return split;
}

exports.fit = function(markdown, query, max) {

	markdown = (markdown || '').trim();
	max = max || 3500;

	if (markdown.length <= max)
		return markdown;

	var list = blocks(markdown);
	var words = (query || '').toLowerCase().split(' ').filter(word => word.length > 2);
	var chosen = {};
	var used = 0;

	function take(index) {
		chosen[index] = 1;
		used += list[index].length + 2;
	}

	// The start of the page: the title, the description and the first block of text, at most a third of the space
	var lead = 0;
	while (lead < list.length && (lead === 0 || used + list[lead].length < max / 3) && (lead < 2 || !/^#{2,6} /.test(list[lead])) && lead < 3) {
		take(lead);
		lead++;
	}

	var scored = [];

	for (var i = lead; i < list.length; i++) {
		var lower = list[i].toLowerCase();
		var score = 0;
		words.forEach(word => lower.indexOf(word) !== -1 && score++);
		scored.push({ index: i, score: score });
	}

	// The best blocks first; when none says anything about the request the page continues in its own order
	scored.sort((a, b) => b.score - a.score || a.index - b.index);

	for (var entry of scored) {
		if (used + list[entry.index].length + 2 <= max)
			take(entry.index);
	}

	var parts = [];
	var last = -1;

	list.forEach(function(block, index) {
		if (!chosen[index])
			return;
		if (last !== -1 && index !== last + 1)
			parts.push('[...]');
		parts.push(block);
		last = index;
	});

	if (last !== list.length - 1)
		parts.push('[...]');

	return parts.join('\n\n');
};

// The pages of the library of Totem and of the documents of Forge for the request. callback(found) when there are pages, otherwise empty() is called
// (the caller tries the MCP server). use: { library, forge }
function fromdocs(run, asked, pages, recipetext, callback, empty, use) {

	use = use || { forge: true };

	var load = function(done) {
		var library = use.library ? loadlibrary : function(next) { next([]); };
		var forge = use.forge ? loadindex : function(next) { next([]); };
		library(function(mine) {
			forge(function(items) {
				// The library first: with the same score its page is the one that is read
				done(mine.concat(items));
			});
		});
	};

	load(function(items) {

		var chosen = items.length ? exports.rank(items, asked, pages + 4) : [];

		if (!chosen.length) {
			empty();
			return;
		}

		var read = chosen.slice(0, pages);
		var found = [];
		var blocks = [];

		read.wait(function(item, next) {
			get(item.url, function(markdown) {
				var body = markdown ? exports.pagebody(markdown) : '';
				if (body) {
					found.push({ title: item.title, url: item.url.replace(/\.md$/, '/') });
					blocks.push('### {0} ({1})\n{2}'.format(item.title, item.url, conventions(exports.fit(body, asked.query, (run.conf || CONF).forgechars || 3500))));
				}
				next();
			});
		}, function() {

			if (!blocks.length) {
				empty();
				return;
			}

			var more = chosen.slice(pages).map(item => '- {0} ({1}): {2}'.format(item.title, item.url, (item.description || '').substring(0, 120)));

			var head = read.some(item => item.library) ? ('Pages of the library of Totem (' + libraryurl() + ')' + (read.some(item => !item.library) ? (' and of Forge (' + forgeurl() + ')') : '')) : ('Pages of Forge (' + forgeurl() + ')');

			run.knowledge = (recipetext ? (recipetext + '\n\n') : '') + head + ' that match the request of the user. Follow them: they are the documentation of Total.js 5 and jComponent 20.\n\n' + blocks.join('\n\n') + (more.length ? ('\n\nOther pages that may help (read one with the fetch tool):\n' + more.join('\n')) : '');

			callback(found);
		});
	});
}

// The model chooses, among the questions of the library that share words with the question of the user, the one that answers it: the words
// find the candidates, the meaning finds the answer ("fetch a single row" is "read one record"). callback(unit or null)
function choose(run, text, list, callback) {

	if (!list.length || !run.model || !F.aimodels[run.model] || (run.conf || CONF).librarychoose === false) {
		callback(null);
		return;
	}

	var ai = AIMODEL(run.model);
	var done = false;
	var finish = function(unit) {
		if (!done) {
			done = true;
			clearTimeout(timer);
			callback(unit);
		}
	};
	var timer = setTimeout(() => finish(null), 30000);

	ai.conf = run.conf;
	ai.payload.reasoning = 'none';
	ai.payload.messages = [
		{ role: 'system', content: 'You choose the right page of the Total.js documentation. Reply with a number only.' },
		{ role: 'user', content: 'Question of a user:\n' + text.substring(0, 1500) + '\n\nQuestions of the Total.js library:\n' + list.map((unit, index) => (index + 1) + '. ' + unit.title).join('\n') + '\n\nWhich question of the library has the answer to the question of the user? Reply with its number only, or 0 when none of them has it.' }
	];

	ai.callback(function(err, output) {
		var number = err || !output ? 0 : parseInt(((output.content || '').match(/\d+/) || ['0'])[0]);
		finish(number > 0 && number <= list.length ? list[number - 1] : null);
	});
}

// The answers of the library for a question: the one that the model chose and the first one by words, when they differ
function fromanswers(run, text, recipetext, callback, empty) {
	loadquestions(function(units) {

		var list = exports.candidates(units, text, 12);
		var direct = exports.answers(units, text, 1)[0];

		if (!list.length) {
			empty();
			return;
		}

		choose(run, text, list, function(chosen) {

			var given = [chosen, direct].filter((unit, index, arr) => unit && arr.findIndex(other => other && other.key === unit.key) === index);

			if (!given.length) {
				empty();
				return;
			}

			var max = (run.conf || CONF).forgechars || 3500;
			run.knowledge = (recipetext ? (recipetext + '\n\n') : '') + 'Answers of the library of Totem (' + libraryurl() + ') to the question of the user. Answer with them: they are the documentation of Total.js 5 and jComponent 20.\n\n' + given.map(unit => '### ' + unit.title + '\n' + conventions(exports.fit(unit.body, text, max))).join('\n\n');
			callback(given.map(unit => ({ title: unit.title, url: unit.url.replace(/\.md$/, '/') })));
		});
	});
}

// callback([{ title, url }]) with the pages that were added to run.knowledge (an empty list when there is nothing to add)
exports.prefetch = function(run, text, callback_) {

	var conf = run.conf || CONF;
	var pages = conf.forgepages == null ? 2 : conf.forgepages;

	run.knowledge = '';
	run.recipeids = [];

	// A command is a fixed instruction: it has nothing to look up
	if (run.command) {
		callback_([]);
		return;
	}

	// The recipes of Totem, for a request about Total.js 5 (not for a slash command)
	var mine = [];

	if (conf.recipes !== false && (text || '').trim().length >= MINLENGTH && !/^\//.test(text.trim()) && MODS.instructions.istotaljs(run.root, conf))
		mine = exports.recipes(text, conf.reciperesults == null ? 2 : conf.reciperesults);

	// Recipes are request context, so follow-ups keep their references.
	// A small model follows one focused reference. An approximate Forge hit can override the exact recipe.
	// Use Forge when there is no recipe; larger models keep the extra documentation.
	if (mine.length && MODS.agent.smallmodel(run.model)) {
		if (['component', 'toggle-card', 'html-page', 'plugin', 'new-app', 'config'].indexOf(mine[0].id) !== -1) {
			mine = mine.slice(0, 1);
			pages = 0;
		} else
			pages = Math.min(pages, 1);
	}
	run.recipeids = mine.map(r => r.id);
	var named = (text || '').match(/(?:llamad[oa]|named)\s+([a-z][a-z0-9-]*)/i);
	if (named) {
		mine = mine.map(function(recipe) {
			if (recipe.id !== 'toggle-card')
				return recipe;
			return Object.assign({}, recipe, { body: recipe.body.split('message-card').join(named[1].toLowerCase()) });
		});
	}

	var recipetext = mine.length ? ('Recipes of Totem for this request. Follow them exactly: names, style and the way each thing is answered. Do not add anything that is not needed (no user interface for a server question).\n\n' + mine.map(r => '### ' + r.title + '\n' + r.body).join('\n\n')) : '';
	var listed = mine.map(r => ({ title: r.title, url: '' }));

	run.knowledge = recipetext;

	var callback = (function(original) {
		return function(found) {
			original(listed.concat(found || []));
		};
	})(callback_);

	if (!pages || (text || '').trim().length < MINLENGTH || /^\//.test(text.trim())) {
		callback([]);
		return;
	}

	var asked = route(text.trim());
	asked.recipe = mine.length ? mine[0].id : '';
	var canmcp = !!(run.mcp && run.mcp.tools.forge__Forge_search && run.mcp.tools.forge__Forge_page);

	// First the documents of Forge (llms.txt and the pages in Markdown): no server to start and nothing to ask. The MCP server comes after, when they gave nothing.
	var use = { library: conf.library !== false, forge: conf.forge !== false && conf.forgedocs !== false };

	if ((use.library || use.forge) && MODS.instructions.istotaljs(run.root, conf)) {

		var docs = function() {
			fromdocs(run, asked, pages, recipetext, callback, function() {
				canmcp ? viamcp() : callback([]);
			}, use);
		};

		// With libraryanswers, a question gets the one answer of the library that matches it: the pages come only when no answer does
		if (!use.library || !pages || !conf.libraryanswers) {
			docs();
			return;
		}

		fromanswers(run, text, recipetext, callback, docs);
		return;
	}

	if (!canmcp) {
		callback([]);
		return;
	}

	viamcp();

	// The MCP server of Forge: its search and its pages
	function viamcp() {

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

				MODS.mcpclient.call(run, 'forge__Forge_page', { input: { section: item.section, slug: item.slug, max_chars: conf.forgechars || 3500 } }, function(err, content) {

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
	}
};
