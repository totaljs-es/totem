// Finds the models that a provider offers, with what each one can do (context window, tools, reasoning, free).
// Local servers (Ollama, llama.cpp, LM Studio) are probed on this computer. Remote catalogues (OpenRouter) list their models publicly.

exports.id = 'discovery';

// `key` is sent as a Bearer token; `extra` replaces it with the headers of providers that authenticate differently
function request(method, address, key, body, timeout, callback, extra) {

	var url;
	try {
		url = new URL(address);
	} catch (e) {
		callback('@(Invalid URL)');
		return;
	}

	var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
	var data = body ? JSON.stringify(body) : null;
	var headers = { accept: 'application/json', 'user-agent': 'Total.js Totem' };
	var done = false;

	if (extra)
		Object.assign(headers, extra);
	else if (key)
		headers.authorization = 'Bearer ' + key;

	if (data) {
		headers['content-type'] = 'application/json';
		headers['content-length'] = Buffer.byteLength(data);
	}

	function finish(err, json) {
		if (!done) {
			done = true;
			callback(err, json);
		}
	}

	var req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: method, headers: headers, timeout: timeout }, function(res) {
		var text = '';
		res.on('data', chunk => text += chunk);
		res.on('end', function() {
			if (res.statusCode >= 400) {
				finish('{0}'.format(res.statusCode));
				return;
			}
			try {
				finish(null, JSON.parse(text));
			} catch (e) {
				finish('@(The server did not answer with JSON)');
			}
		});
	});

	req.on('timeout', () => req.destroy(new Error('timeout')));
	req.on('error', err => finish(err.message));
	req.end(data);
}

exports.request = request;

function root(url) {
	return url.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function number(value) {
	var n = parseFloat(value);
	return isNaN(n) ? null : n;
}

// Ollama: the list of installed models, then the capabilities and the context of each one
function ollama(provider, callback) {

	var base = root(provider.url);

	request('GET', base + '/api/tags', null, null, 4000, function(err, json) {

		if (err) {
			callback(err);
			return;
		}

		var items = (json.models || []).slice(0, 100);

		items.wait(function(item, next) {
			request('POST', base + '/api/show', null, { model: item.name }, 4000, function(err, info) {
				var caps = (info && info.capabilities) || null;
				var context = null;
				if (info && info.model_info) {
					for (var key in info.model_info) {
						if (/\.context_length$/.test(key))
							context = info.model_info[key];
					}
				}
				// Totem says who it is inside the model: its identity is the system text that it was exported with. It is Totem under any name.
				var totem = !!(info && (/^\s*You are Totem\b/.test(info.system || '') || /(^|[\/_-])totem[-_.]/i.test((info.details && info.details.parent_model) || '')));
				item.meta = { id: item.name, name: item.name, context: context, tools: caps ? caps.indexOf('tools') !== -1 : null, reasoning: caps ? caps.indexOf('thinking') !== -1 : null, vision: caps ? caps.indexOf('vision') !== -1 : null, free: true, price: { input: 0, output: 0 }, size: item.size || null, totem: totem };
				next();
			});
		}, function() {
			callback(null, items.map(item => item.meta));
		});
	});
}

// OpenAI-compatible servers: GET /models. OpenRouter and vLLM add the context and the supported parameters.
function openai(provider, callback) {

	request('GET', provider.url.replace(/\/+$/, '') + '/models', provider.key, null, 8000, function(err, json) {

		if (err) {
			callback(err);
			return;
		}

		var list = json.data || json.models || [];

		callback(null, list.map(function(m) {

			var params = m.supported_parameters;
			var price = m.pricing ? number(m.pricing.prompt) : null;
			var output = m.pricing ? number(m.pricing.completion) : null;
			var context = m.context_length || m.max_model_len || (m.meta && m.meta.n_ctx_train) || (m.top_provider && m.top_provider.context_length) || null;

			return {
				id: m.id || m.name,
				name: m.name || m.id,
				context: context,
				tools: params ? params.indexOf('tools') !== -1 : null,
				reasoning: params ? (params.indexOf('reasoning') !== -1 || params.indexOf('include_reasoning') !== -1) : null,
				vision: m.architecture && Array.isArray(m.architecture.input_modalities) ? m.architecture.input_modalities.indexOf('image') !== -1 : null,
				free: price === null ? null : price === 0,
				price: price === null ? null : { input: price, output: output || 0 },
				size: null
			};
		}));
	});
}

// Does a Claude model think? The list says so in `capabilities` when it can; otherwise the family decides (3.7 and every 4 and later)
function claudethinks(m) {
	var thinking = m.capabilities && m.capabilities.thinking;
	if (thinking && typeof(thinking.supported) === 'boolean')
		return thinking.supported;
	return /^claude-(3-7|(sonnet|opus|haiku)-[4-9]|fable)/.test(m.id || '') ? true : null;
}

// Anthropic: GET /v1/models. Every Claude model can call tools.
function anthropic(provider, callback) {
	request('GET', provider.url.replace(/\/+$/, '') + '/v1/models?limit=100', null, null, 8000, function(err, json) {

		if (err) {
			callback(err);
			return;
		}

		callback(null, (json.data || []).map(m => ({ id: m.id, name: m.display_name || m.id, context: m.max_input_tokens || null, tools: true, reasoning: claudethinks(m), vision: true, free: false, size: null })));
	}, { 'x-api-key': provider.key || '', 'anthropic-version': '2023-06-01' });
}

// Gemini: GET /v1beta/models. Only the models that can generate content are offered.
function gemini(provider, callback) {
	request('GET', provider.url.replace(/\/+$/, '') + '/v1beta/models?pageSize=1000', null, null, 8000, function(err, json) {

		if (err) {
			callback(err);
			return;
		}

		var list = (json.models || []).filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.indexOf('generateContent') !== -1);

		callback(null, list.map(m => ({ id: (m.name || '').replace(/^models\//, ''), name: m.displayName || m.name, context: m.inputTokenLimit || null, tools: true, reasoning: typeof(m.thinking) === 'boolean' ? m.thinking : null, vision: true, free: null, size: null })));
	}, { 'x-goog-api-key': provider.key || '' });
}

// LiteLLM: /model/info has the context window, the support of tools and reasoning and the price of each model. When the proxy does not
// answer it (it needs the master key, or it is an older version) the list of /models is used.
function litellm(provider, callback) {

	request('GET', root(provider.url) + '/model/info', provider.key, null, 8000, function(err, json) {

		if (err || !json || !Array.isArray(json.data)) {
			openai(provider, callback);
			return;
		}

		var seen = {};
		var models = [];

		json.data.forEach(function(m) {

			var id = m.model_name;

			if (!id || seen[id])
				return;

			seen[id] = true;

			var info = m.model_info || {};
			var input = number(info.input_cost_per_token);
			var output = number(info.output_cost_per_token);

			models.push({
				id: id,
				name: id,
				context: info.max_input_tokens || info.max_tokens || null,
				tools: typeof(info.supports_function_calling) === 'boolean' ? info.supports_function_calling : null,
				reasoning: typeof(info.supports_reasoning) === 'boolean' ? info.supports_reasoning : null,
				vision: typeof(info.supports_vision) === 'boolean' ? info.supports_vision : null,
				free: input === null ? null : input === 0,
				price: input === null ? null : { input: input, output: output || 0 },
				size: null,
				// The model behind the name of the gateway (ollama/qwen2.5:1.5b): the name that the team chose says nothing about its size
				underlying: (m.litellm_params && m.litellm_params.model) || info.key || null
			});
		});

		callback(null, models);
	});
}

var KINDS = { ollama: ollama, anthropic: anthropic, gemini: gemini, litellm: litellm };

// callback(err, [{ id, name, context, tools, reasoning, free, size }]). Unknown values are null.
exports.available = function(provider, callback) {
	(KINDS[provider.kind] || openai)(provider, function(err, models) {
		if (err)
			callback(err);
		else
			callback(null, models.sort((a, b) => a.id.localeCompare(b.id)));
	});
};

// The local servers that answer on this computer: [{ template, models }]
exports.detect = function(templates, callback) {

	var found = [];

	// The servers of this computer, and the ones that are usually on it (LiteLLM runs on a port of the computer or on a server of the team)
	templates.filter(t => t.local || t.detect).wait(function(template, next) {

		var provider = { url: template.url, kind: template.kind, key: '' };
		var started = Date.now();

		// A short probe: a closed port refuses at once, a server that does not answer is not worth waiting for
		request('GET', root(template.url) + (template.kind === 'ollama' ? '/api/tags' : '/v1/models'), null, null, 1200, function(err) {

			if (err) {
				next();
				return;
			}

			exports.available(provider, function(err, models) {
				found.push({ template: template, models: err ? [] : models, ms: Date.now() - started });
				next();
			});
		});

	}, () => callback(null, found));
};
