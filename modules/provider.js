// Model providers. A provider is configuration: its `kind` picks the request format and the stream parser of the framework.
//
//   openai      Chat Completions (OpenAI, OpenRouter, Ollama, llama.cpp, LM Studio and every compatible server)
//   anthropic   Messages API
//   gemini      generateContent with streaming
//
// The conversation is kept in the Chat Completions format (system, user, assistant with tool_calls, tool). Each kind converts it
// for its own API; the answer comes back through the parser of the framework as { content, thinking, tools, usage }.

exports.id = 'provider';

var MAXTOKENS = 8192;

// Tokens that a model may spend thinking, per level of the interface (none and the default send nothing)
var THINKBUDGET = { low: 2048, medium: 8192, high: 16384 };
var GEMINIBUDGET = { low: 1024, medium: 8192, high: 24576 };

// Sends one streaming request. spec: { url, headers, body, parser, sniff(object, state) } where sniff reads from every event of the
// stream what the parser of the framework does not keep (usage, signatures). It fills state.usage and state.calls.
function stream(ai, callback, spec) {

	var url = new URL(spec.url);
	var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
	var body = JSON.stringify(spec.body);
	var headers = Object.assign({ 'content-type': 'application/json', 'accept': 'text/event-stream', 'content-length': Buffer.byteLength(body) }, spec.headers);
	var finished = false;

	function done(err, response) {
		if (!finished) {
			finished = true;
			callback(err, response);
		}
	}

	var req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: headers }, function(res) {

		if (res.statusCode >= 400) {
			var error = '';
			res.on('data', chunk => error += chunk);
			res.on('end', () => done('{0}: {1}'.format(res.statusCode, error.substring(0, 500))));
			return;
		}

		var parser = AIPARSER(spec.parser);

		parser.on('*', function(e) {
			ai.options.stream && ai.options.stream(e);
		});

		// The usage of the request is in the stream: the parser of the framework does not keep it
		var state = { usage: null, calls: [] };
		var tail = '';

		res.on('data', function(chunk) {

			parser.write(chunk);

			tail += chunk.toString('utf8');
			var lines = tail.split('\n');
			tail = lines.pop();

			// A line of an event stream starts with "data:"; a line of Ollama is the JSON itself
			for (var line of lines) {
				var text = line.indexOf('data:') === 0 ? line.substring(5).trim() : line.trim();
				if (text.charAt(0) === '{') {
					try {
						spec.sniff(JSON.parse(text), state);
					} catch (e) {}
				}
			}
		});

		res.on('end', function() {
			var output = parser.end();

			if (state.usage)
				output.usage = state.usage;

			// Claude asks for its thinking block, with the signature, to come back in the same turn when the step called a tool
			if (output.thinking && output.thinking_signature)
				output.thinkingblocks = [{ type: 'thinking', thinking: output.thinking, signature: output.thinking_signature }];

			// Gemini 3 asks for the signature of a function call to come back with it
			(output.tools || []).forEach(function(tool, index) {
				if (state.calls[index])
					tool.thoughtSignature = state.calls[index];
			});

			done(null, output);
		});

		res.on('error', err => done(err.message));
	});

	ai.options.abort = function() {
		done('aborted');
		req.destroy();
	};

	req.on('error', err => done(err.message));
	req.end(body);
}

function base(config) {
	return (config.url || '').replace(/\/+$/, '');
}

function json(text) {
	try {
		return JSON.parse(text || '{}');
	} catch (e) {
		return {};
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// OpenAI Chat Completions

// A server of this computer or of its network: localhost, a loopback address or a private one
exports.islocal = function(url) {
	return /^https?:\/\/(localhost|127(\.\d{1,3}){3}|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(?=[:/]|$)/.test(url || '');
};

exports.openai = function(ai, callback) {

	var config = ai.config;
	var conf = ai.conf || CONF;
	// The signatures of Gemini function calls are not part of this format
	var messages = ai.payload.messages.map(function(m) {
		if (!m.tool_calls && !m.thinking_blocks)
			return m;
		var copy = Object.assign({}, m);
		delete copy.thinking_blocks;
		if (m.tool_calls)
			copy.tool_calls = m.tool_calls.map(c => ({ id: c.id, type: c.type, function: c.function }));
		return copy;
	});

	var body = { model: config.model, messages: messages, stream: true, stream_options: { include_usage: true } };

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = ai.payload.tools;

	// Ollama behind a gateway (LiteLLM): the gateway does not know the size of the prompt, and Ollama cuts it at its default window (2048 or 4096
	// tokens), which takes the instructions away from the model. The window and the penalty for repeating go as parameters of the request, which the
	// gateway passes on to Ollama.
	if (/^ollama(_chat)?\//.test(ai.payload.underlying || '')) {
		body.num_ctx = conf.ollamactx || 16384;
		if (conf.ollamarepeat)
			body.repeat_penalty = conf.ollamarepeat;
	}

	// A model of up to 4 billion parameters never needs a long answer, and it is the one that does not stop: the same limit as Ollama's, as max_tokens
	if (conf.ollamapredictsmall && (ai.payload.small || MODS.agent.smallmodel(config.model)) && !body.max_tokens)
		body.max_tokens = conf.ollamapredictsmall;

	// Code needs a steady hand: the servers of this computer (Ollama, llama.cpp, vLLM, LM Studio) are asked for a low temperature, because
	// their default (0.7 or 0.8) makes a small model drift from the instructions. A remote provider keeps its own default: some models
	// (the reasoning ones) refuse any other value.
	if (conf.temperature != null && conf.temperature !== '' && exports.islocal(config.url))
		body.temperature = conf.temperature;

	// How much the model thinks: none, low, medium or high. Empty leaves the default of the model.
	if (['none', 'low', 'medium', 'high'].indexOf(ai.payload.reasoning) !== -1)
		body.reasoning_effort = ai.payload.reasoning;

	stream(ai, callback, {
		url: base(config) + '/chat/completions',
		headers: config.key ? { authorization: 'Bearer ' + config.key } : {},
		body: body,
		parser: 'openai_chat',
		sniff: function(obj, state) {
			if (obj.usage)
				state.usage = { input: obj.usage.prompt_tokens || 0, output: obj.usage.completion_tokens || 0 };
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Ollama, with its own API (/api/chat)
//
// The OpenAI-compatible address of Ollama cannot set the size of the context: the model reads only the first 2048 or 4096 tokens of
// the request and silently drops the rest, which is where the instructions of Totem are. /api/chat takes options.num_ctx.

// Chat Completions messages -> messages of /api/chat
exports.toollama = function(messages) {

	var names = {};
	var output = [];

	for (var m of messages) {

		if (m.role === 'system') {
			output.push({ role: 'system', content: m.content });
			continue;
		}

		if (m.role === 'user') {

			if (!Array.isArray(m.content)) {
				output.push({ role: 'user', content: m.content || '' });
				continue;
			}

			var images = [];
			var text = [];

			for (var part of m.content) {
				if (part.type === 'image_url')
					images.push(part.image_url.url.replace(/^data:[^;]+;base64,/, ''));
				else
					text.push(part.text);
			}

			output.push({ role: 'user', content: text.join('\n'), images: images });
			continue;
		}

		if (m.role === 'assistant') {

			var msg = { role: 'assistant', content: m.content || '' };

			if (m.tool_calls && m.tool_calls.length) {
				msg.tool_calls = m.tool_calls.map(function(call) {
					names[call.id] = call.function.name;
					return { function: { name: call.function.name, arguments: json(call.function.arguments) } };
				});
			}

			output.push(msg);
			continue;
		}

		output.push({ role: 'tool', tool_name: names[m.tool_call_id] || 'tool', content: m.content || '' });
	}

	return output;
};

// The size of the context to ask for: the one of the config at least (so that the model is not reloaded for every request), more when the
// request needs it, never more than the window of the model
exports.contextsize = function(messages, tools, config, conf) {

	conf = conf || CONF;
	var floor = conf.ollamactx || 16384;
	var window = Math.max(Math.min(config.context || 32768, conf.ollamactxmax || 32768), 4096);
	var size = JSON.stringify(messages).length + JSON.stringify(tools || []).length;
	var needed = Math.ceil(size / 3.2) + 2048;

	return Math.min(Math.max(floor, Math.ceil(needed / 4096) * 4096), Math.max(window, 4096));
};

exports.ollama = function(ai, callback) {

	var config = ai.config;
	var conf = ai.conf || CONF;
	var tools = ai.payload.tools && ai.payload.tools.length ? ai.payload.tools : null;
	var options = { num_ctx: exports.contextsize(ai.payload.messages, tools, config, ai.conf) };

	if (conf.temperature != null && conf.temperature !== '')
		options.temperature = conf.temperature;

	// A small model can fall into a loop and repeat one paragraph until the context is full: a penalty for repeating, and a limit for one answer
	if (conf.ollamarepeat)
		options.repeat_penalty = conf.ollamarepeat;

	if (conf.ollamapredict)
		options.num_predict = conf.ollamapredict;

	// A model of up to 4 billion parameters does not need long answers (a recipe is a few hundred tokens), and it is the one that never stops: a lower limit
	if (conf.ollamapredictsmall && (ai.payload.small || MODS.agent.smallmodel(config.model)))
		options.num_predict = Math.min(options.num_predict || conf.ollamapredictsmall, conf.ollamapredictsmall);

	var body = { model: config.model, messages: exports.toollama(ai.payload.messages), stream: true, options: options };

	if (tools)
		body.tools = tools;

	// Thinking is a switch for the models that think: off for "none", on for the other levels
	if (config.reasoning === true && ['none', 'low', 'medium', 'high'].indexOf(ai.payload.reasoning) !== -1)
		body.think = ai.payload.reasoning !== 'none';

	stream(ai, callback, {
		url: base(config).replace(/\/v1$/, '') + '/api/chat',
		headers: {},
		body: body,
		parser: 'ollama',
		sniff: function(obj, state) {
			if (obj.done === true && (obj.prompt_eval_count || obj.eval_count))
				state.usage = { input: obj.prompt_eval_count || 0, output: obj.eval_count || 0 };
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Anthropic Messages API

// A part of a user message (text or image as a data URL) -> a block of the Messages API
function anthropicpart(part) {

	if (part.type !== 'image_url')
		return { type: 'text', text: part.text };

	var match = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
	return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
}

// Chat Completions messages -> { system, messages } of the Messages API
exports.toanthropic = function(messages) {

	var system = [];
	var output = [];

	for (var m of messages) {

		if (m.role === 'system') {
			system.push(m.content);
			continue;
		}

		if (m.role === 'user') {
			output.push({ role: 'user', content: Array.isArray(m.content) ? m.content.map(anthropicpart) : (m.content || '') });
			continue;
		}

		if (m.role === 'assistant') {

			var blocks = (m.thinking_blocks || []).slice();

			if (m.content)
				blocks.push({ type: 'text', text: m.content });

			for (var call of (m.tool_calls || []))
				blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: json(call.function.arguments) });

			if (blocks.length)
				output.push({ role: 'assistant', content: blocks });

			continue;
		}

		// The results of the tools of one step go together in one user message
		var block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' };
		var last = output[output.length - 1];

		if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0].type === 'tool_result')
			last.content.push(block);
		else
			output.push({ role: 'user', content: [block] });
	}

	return { system: system.join('\n'), messages: output };
};

exports.anthropic = function(ai, callback) {

	var config = ai.config;
	var converted = exports.toanthropic(ai.payload.messages);
	var body = { model: config.model, max_tokens: MAXTOKENS, stream: true, messages: converted.messages };

	if (converted.system)
		body.system = converted.system;

	// Extended thinking: a budget of tokens for the models that think. The answer needs room after it.
	var budget = config.reasoning === true ? THINKBUDGET[ai.payload.reasoning] : 0;

	if (budget) {
		body.thinking = { type: 'enabled', budget_tokens: budget };
		body.max_tokens = budget + MAXTOKENS;
	}

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = ai.payload.tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));

	stream(ai, callback, {
		url: base(config) + '/v1/messages',
		headers: { 'x-api-key': config.key || '', 'anthropic-version': '2023-06-01' },
		body: body,
		parser: 'anthropic',
		sniff: function(obj, state) {
			if (obj.type === 'message_start' && obj.message && obj.message.usage)
				state.usage = Object.assign(state.usage || { input: 0, output: 0 }, { input: obj.message.usage.input_tokens || 0 });
			else if (obj.type === 'message_delta' && obj.usage)
				state.usage = Object.assign(state.usage || { input: 0, output: 0 }, { output: obj.usage.output_tokens || 0 });
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Gemini generateContent

// Parameters of a tool in the subset of JSON Schema that Gemini accepts
function geminischema(schema) {
	var out = {};
	for (var key in schema) {
		if (key === 'additionalProperties')
			continue;
		out[key] = key === 'properties' ? Object.keys(schema.properties || {}).reduce(function(map, name) {
			map[name] = geminischema(schema.properties[name]);
			return map;
		}, {}) : schema[key];
	}
	return out;
}

// A part of a user message (text or image as a data URL) -> a part of generateContent
function geminipart(part) {

	if (part.type !== 'image_url')
		return { text: part.text };

	var match = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
	return { inlineData: { mimeType: match[1], data: match[2] } };
}

// Chat Completions messages -> { system, contents } of generateContent
exports.togemini = function(messages) {

	var system = [];
	var contents = [];
	var names = {};

	for (var m of messages) {

		if (m.role === 'system') {
			system.push(m.content);
			continue;
		}

		if (m.role === 'user') {
			contents.push({ role: 'user', parts: Array.isArray(m.content) ? m.content.map(geminipart) : [{ text: m.content || '' }] });
			continue;
		}

		if (m.role === 'assistant') {

			var parts = [];

			if (m.content)
				parts.push({ text: m.content });

			for (var call of (m.tool_calls || [])) {
				names[call.id] = call.function.name;
				var part = { functionCall: { name: call.function.name, args: json(call.function.arguments) } };
				if (call.thoughtSignature)
					part.thoughtSignature = call.thoughtSignature;
				parts.push(part);
			}

			if (parts.length)
				contents.push({ role: 'model', parts: parts });

			continue;
		}

		var part = { functionResponse: { name: names[m.tool_call_id] || 'tool', response: { output: m.content || '' } } };
		var last = contents[contents.length - 1];

		if (last && last.role === 'user' && last.parts[0].functionResponse)
			last.parts.push(part);
		else
			contents.push({ role: 'user', parts: [part] });
	}

	return { system: system.join('\n'), contents: contents };
};

exports.gemini = function(ai, callback) {

	var config = ai.config;
	var converted = exports.togemini(ai.payload.messages);
	var body = { contents: converted.contents };

	if (converted.system)
		body.systemInstruction = { parts: [{ text: converted.system }] };

	// Thinking: Gemini 3 takes a level, Gemini 2.5 a budget of tokens (0 switches it off, except in Pro, which keeps a minimum). The thoughts come back
	// as parts marked as thoughts, which the parser turns into reasoning.
	var level = ai.payload.reasoning;

	if (config.reasoning === true && (GEMINIBUDGET[level] || level === 'none')) {
		if (/gemini-3/.test(config.model)) {
			if (level !== 'none')
				body.generationConfig = { thinkingConfig: { thinkingLevel: level === 'low' ? 'low' : 'high', includeThoughts: true } };
		} else
			body.generationConfig = { thinkingConfig: { thinkingBudget: level === 'none' ? (/pro/.test(config.model) ? 128 : 0) : GEMINIBUDGET[level], includeThoughts: level !== 'none' } };
	}

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = [{ functionDeclarations: ai.payload.tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: geminischema(t.function.parameters) })) }];

	stream(ai, callback, {
		url: base(config) + '/v1beta/models/' + encodeURIComponent(config.model) + ':streamGenerateContent?alt=sse',
		headers: { 'x-goog-api-key': config.key || '' },
		body: body,
		parser: 'gemini',
		sniff: function(obj, state) {

			if (obj.usageMetadata)
				state.usage = { input: obj.usageMetadata.promptTokenCount || 0, output: obj.usageMetadata.candidatesTokenCount || 0 };

			// The function calls in the order they arrive, each with its signature when it has one
			for (var candidate of (obj.candidates || [])) {
				for (var part of ((candidate.content && candidate.content.parts) || [])) {
					if (part.functionCall)
						state.calls.push(part.thoughtSignature || null);
				}
			}
		}
	});
};

// The function that sends the requests of a provider kind
exports.byKind = function(kind) {
	return exports[kind === 'anthropic' || kind === 'gemini' || kind === 'ollama' ? kind : 'openai'];
};
