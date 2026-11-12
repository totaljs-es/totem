NEWACTION('Providers|list', {
	name: 'List providers',
	action: async function($) {
		var items = await NOSQL('providers').find().promise($);
		for (var item of items) {
			item.haskey = !!item.key;
			item.icon = FUNC.providericon(item);
			delete item.key;
			delete item.meta;
		}
		$.callback(items);
	}
});

NEWACTION('Providers|save', {
	name: 'Save a provider',
	input: 'id:String, *name:String, *url:String, kind:String, icon:String, key:String, models:[String], meta:Object, disabled:Boolean, newmodels:Boolean',
	action: async function($, model) {

		var item = model.id ? await NOSQL('providers').read().where('id', model.id).promise($) : null;

		if (model.id && !item) {
			$.invalid(404);
			return;
		}

		// Adding a provider that already exists (for example detecting Ollama again) refreshes it: no second one is created
		if (!item) {
			item = await NOSQL('providers').read().where('id', model.name.slug()).promise($);
			if (item)
				model.id = item.id;
		}

		var data = { name: model.name, url: model.url, kind: model.kind || 'openai', icon: model.icon || '', models: model.models || [], meta: model.meta || {}, disabled: !!model.disabled, newmodels: !!model.newmodels && (model.kind === 'ollama'), dtupdated: NOW };

		// An empty key keeps the stored one: the interface never receives it
		if (model.key)
			data.key = FUNC.encryptkey(model.key);

		// Metadata that the form did not send is kept, but only for the models that remain
		if (item && item.meta) {
			for (var key in item.meta) {
				if (!data.meta[key] && data.models.indexOf(key) !== -1)
					data.meta[key] = item.meta[key];
			}
		}

		if (item)
			await NOSQL('providers').modify(data).where('id', item.id).promise($);
		else {
			data.id = model.name.slug();
			data.key = data.key || '';
			data.dtcreated = NOW;
			await NOSQL('providers').insert(data).promise($);
		}

		FUNC.providers();
		$.success(data.id || item.id);
	}
});

NEWACTION('Providers|remove', {
	name: 'Remove a provider',
	params: '*id',
	action: async function($) {
		await NOSQL('providers').remove().where('id', $.params.id).promise($);
		$.success();
	}
});

NEWACTION('Providers|models', {
	name: 'Models that can be used in a session',
	action: function($) {
		var items = Object.keys(F.aimodels).sort();
		$.callback(items);
	}
});


NEWACTION('Providers|templates', {
	name: 'Providers that can be added',
	action: function($) {
		$.callback(MAIN.templates);
	}
});

NEWACTION('Providers|detect', {
	name: 'Local servers found on this computer',
	action: function($) {
		MODS.discovery.detect(MAIN.templates, (err, found) => $.callback(found));
	}
});

NEWACTION('Providers|available', {
	name: 'All the models that a provider offers',
	input: 'id:String, url:String, kind:String, key:String',
	action: async function($, model) {

		var provider = { url: model.url, kind: model.kind || 'openai', key: model.key || '' };

		// Editing a saved provider: the stored key is used when no key is typed
		if (model.id) {
			var item = await NOSQL('providers').read().where('id', model.id).promise($);
			if (item) {
				provider.url = provider.url || item.url;
				provider.kind = model.kind || item.kind || 'openai';
				provider.key = provider.key || FUNC.decryptkey(item.key);
			}
		}

		if (!provider.url) {
			$.invalid('@(The URL is required)');
			return;
		}

		MODS.discovery.available(provider, function(err, models) {
			if (err)
				$.invalid(FUNC.plain(typeof(err) === 'string' ? err : 'Error'));
			else
				$.callback(models);
		});
	}
});

NEWACTION('Providers|catalog', {
	name: 'Models of the providers with what each one can do',
	action: function($) {
		var items = Object.keys(F.aimodels).sort().map(function(id) {
			var meta = MAIN.modelmeta[id] || {};
			var provider = MAIN.modelprov[id] || {};
			return { id: id, name: meta.name || id, provider: provider.name || '', icon: provider.icon || '', context: meta.context || null, tools: meta.tools === undefined ? null : meta.tools, reasoning: meta.reasoning === undefined ? null : meta.reasoning, vision: meta.vision === undefined ? null : meta.vision, free: meta.free === undefined ? null : meta.free };
		});
		$.callback(items);
	}
});
