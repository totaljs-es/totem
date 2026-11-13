// Registers the models of the configured providers. A model is addressed as "providerid:model".
// The provider `fake` is registered by the tests.
// The icon of a provider: the one it was saved with, or its id when public/img/providers has that icon
FUNC.providericon = function(item) {
	var icons = FUNC.providericons || (FUNC.providericons = (function() {
		var map = {};
		try {
			Total.Fs.readdirSync(PATH.public('img/providers')).forEach(file => /\.svg$/.test(file) && (map[file.replace(/\.svg$/, '')] = 1));
		} catch (e) {}
		return map;
	})());
	var icon = item.icon || item.id;
	return icons[icon] ? icon : '';
};

// Totem, the model trained for this application, whatever serves it: its name says so (totem:4b, totem-v4:4b, hf.co/totaljs-es/totem-4b...),
// or the metadata that the provider gave for it. The interface shows it with its own icon.
FUNC.istotem = function(model, meta) {
	return !!((meta && meta.totem) || /(^|[\/:_.-])totem([\/:_.-]|\d|$)/i.test(model || ''));
};

// The models that refused the images of a prompt (until Totem starts again)
MAIN.blind = {};

FUNC.providers = function(callback) {
	NOSQL('providers').find().callback(function(err, response) {

		MAIN.secrets = [];
		MAIN.modelmeta = {};
		MAIN.modelprov = {};

		for (var item of (response || [])) {

			var key = FUNC.decryptkey(item.key);
			if (key)
				MAIN.secrets.push(key);

			if (item.disabled)
				continue;
			for (var model of item.models) {
				var meta = (item.meta && item.meta[model]) || {};
				var config = { url: item.url, key: key, model: model, context: meta.context || null, reasoning: meta.reasoning === undefined ? null : meta.reasoning };
				NEWAIMODEL(item.id + ':' + model, config, MODS.provider.byKind(item.kind));
				MAIN.modelmeta[item.id + ':' + model] = Object.assign({}, meta);
				MAIN.modelmeta[item.id + ':' + model].totem = FUNC.istotem(model, meta);

				// A model that refused the images of a prompt stays remembered as one that cannot see
				if (MAIN.blind[item.id + ':' + model])
					MAIN.modelmeta[item.id + ':' + model].vision = false;

				// The window that Totem really uses: Ollama is asked for a context that is as large as the config allows
				if (item.kind === 'ollama')
					MAIN.modelmeta[item.id + ':' + model].window = Math.max(Math.min(meta.context || 32768, CONF.ollamactxmax || 32768), 4096);
				MAIN.modelprov[item.id + ':' + model] = { id: item.id, name: item.name, icon: FUNC.providericon(item) };
			}
		}
		callback && callback();
	});
};

// A local Ollama, asked what it has:
// - with the option "newmodels", the models installed after the provider was saved are added to it, with what each one can do. A model that
//   is gone is not removed.
// - a model of the provider that Totem knows nothing about (its name was typed by hand in the form) gets what the server says of it: whether
//   it calls tools, whether it thinks, its context. Without that, the thinking of a small model is not switched off and its answer stays there.
// Only Ollama (the models of this computer, which the person installed). callback(added)
// One look at a time: a call while one runs waits for it and asks for one more look after it (a provider saved, a model installed in
// between), and every caller gets the number of models that all those looks added. Two looks at the same time would add a model twice
// or tell the second caller that nothing was added.
var NEWMODELS = null;

FUNC.newmodels = function(callback) {

	if (NEWMODELS) {
		NEWMODELS.again = true;
		callback && NEWMODELS.callbacks.push(callback);
		return;
	}

	NEWMODELS = { again: false, added: 0, callbacks: callback ? [callback] : [] };

	(function look() {
		NEWMODELS.again = false;
		newmodels(function(added) {
			NEWMODELS.added += added;
			if (NEWMODELS.again) {
				look();
				return;
			}
			var done = NEWMODELS;
			NEWMODELS = null;
			done.callbacks.forEach(fn => fn(done.added));
		});
	})();
};

function newmodels(callback) {

	var added = 0;
	var changed = false;

	NOSQL('providers').find().callback(function(err, response) {

		var items = (response || []).filter(item => item.kind === 'ollama' && !item.disabled);

		items.wait(function(item, next) {

			var meta = item.meta || {};
			var unknown = item.models.filter(model => !meta[model]);

			if (!item.newmodels && !unknown.length) {
				next();
				return;
			}

			MODS.discovery.available({ url: item.url, kind: item.kind, key: '' }, function(err, models) {

				if (err) {
					next();
					return;
				}

				var fresh = item.newmodels ? models.filter(model => item.models.indexOf(model.id) === -1) : [];
				var known = models.filter(model => unknown.indexOf(model.id) !== -1);

				if (!fresh.length && !known.length) {
					next();
					return;
				}

				fresh.forEach(function(model) {
					item.models.push(model.id);
					meta[model.id] = model;
				});

				known.forEach(function(model) {
					meta[model.id] = model;
				});

				added += fresh.length;
				changed = true;
				NOSQL('providers').modify({ models: item.models, meta: meta, dtupdated: NOW }).where('id', item.id).callback(next);
			});

		}, function() {
			if (changed)
				FUNC.providers(() => callback && callback(added));
			else
				callback && callback(added);
		});
	});
}
