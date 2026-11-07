// MCP client: the tools of MCP servers become tools of the agent. Servers are declared by the project in .totem/mcp.json:
//
//   { "servers": {
//       "files": { "command": "node", "args": ["server.js"], "env": { "KEY": "value" } },
//       "docs": { "url": "https://example.com/mcp", "headers": { "authorization": "Bearer ..." } } } }
//
// A project file can start a program, so every server is started only after the user allows it (permission "mcp-start"), and
// its tools ask before they run. Transports: stdio (newline-delimited JSON-RPC) and HTTP (JSON or event-stream answers).

exports.id = 'mcpclient';

var VERSION = '2025-06-18';

// The servers of the project, plus the ones that come with Totem for Total.js projects (Forge). The project can replace one by name.
exports.servers = function(root) {

	var servers = {};

	// The documents of Forge already give the knowledge (llms.txt and its pages), so its MCP server, which asks for permission to start, is an extra: forgemcp
	if (CONF.forge !== false && (CONF.forgemcp === true || CONF.forgedocs === false) && MODS.instructions.istotaljs(root)) {
		try {
			Object.assign(servers, JSON.parse(Total.Fs.readFileSync(PATH.private('mcp.json'), 'utf8')).servers);
		} catch (e) {}
	}

	try {
		Object.assign(servers, JSON.parse(Total.Fs.readFileSync(Total.Path.join(root, '.totem/mcp.json'), 'utf8')).servers || {});
	} catch (e) {}

	return servers;
};

function label(config) {
	return config.url ? config.url : [config.command].concat(config.args || []).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Transports: send(method, params, timeout, callback), notify(method, params), close()

function stdio(config, root, sessionid) {

	var env = { PATH: process.env.PATH, HOME: process.env.HOME };

	for (var key in (config.env || {}))
		env[key] = config.env[key];

	var child = Total.Child.spawn(config.command, config.args || [], { cwd: root, env: env, stdio: ['pipe', 'pipe', 'ignore'] });
	var pending = {};
	var counter = 0;
	var buffer = '';
	var closed = false;

	if (!MAIN.children[sessionid])
		MAIN.children[sessionid] = [];

	MAIN.children[sessionid].push(child);

	function fail(message) {
		for (var id in pending) {
			clearTimeout(pending[id].timer);
			pending[id].callback(message);
		}
		pending = {};
	}

	child.stdout.on('data', function(chunk) {

		buffer += chunk.toString('utf8');
		var lines = buffer.split('\n');
		buffer = lines.pop();

		for (var line of lines) {

			var msg;
			try {
				msg = JSON.parse(line);
			} catch (e) {
				continue;
			}

			var item = msg.id != null && pending[msg.id];

			if (item) {
				delete pending[msg.id];
				clearTimeout(item.timer);
				item.callback(msg.error ? (msg.error.message || 'MCP error') : null, msg.result);
			}
		}
	});

	child.on('error', err => fail(err.message));
	child.on('close', function() {

		closed = true;
		fail('The MCP server stopped');

		var list = MAIN.children[sessionid];
		if (list) {
			var index = list.indexOf(child);
			if (index !== -1)
				list.splice(index, 1);
			if (!list.length)
				delete MAIN.children[sessionid];
		}
	});

	return {
		send: function(method, params, timeout, callback) {

			if (closed) {
				callback('The MCP server stopped');
				return;
			}

			var id = ++counter;
			var timer = setTimeout(function() {
				delete pending[id];
				callback('The MCP server did not answer in time');
			}, timeout);

			pending[id] = { callback: callback, timer: timer };
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params || {} }) + '\n');
		},
		notify: function(method, params) {
			!closed && child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: method, params: params || {} }) + '\n');
		},
		close: function() {
			closed = true;
			child.kill();
		}
	};
}

function http(config) {

	var counter = 0;
	var session = '';

	function post(body, timeout, callback) {

		var url = new URL(config.url);
		var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
		var data = JSON.stringify(body);
		var headers = Object.assign({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(data), 'mcp-protocol-version': VERSION }, config.headers || {});
		var done = false;

		if (session)
			headers['mcp-session-id'] = session;

		function finish(err, result) {
			if (!done) {
				done = true;
				callback(err, result);
			}
		}

		var req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: headers, timeout: timeout }, function(res) {

			if (res.headers['mcp-session-id'])
				session = res.headers['mcp-session-id'];

			var text = '';
			res.on('data', chunk => text += chunk);
			res.on('end', function() {

				if (res.statusCode >= 400) {
					finish('HTTP ' + res.statusCode);
					return;
				}

				if (res.statusCode === 202 || !text.trim()) {
					finish(null, null);
					return;
				}

				// An event stream: the message with our id is in a data line
				var payload = text;
				if (/text\/event-stream/.test(res.headers['content-type'] || '')) {
					payload = '';
					text.split('\n').forEach(function(line) {
						if (line.indexOf('data:') === 0 && body.id != null) {
							try {
								var m = JSON.parse(line.substring(5).trim());
								if (m.id === body.id)
									payload = line.substring(5).trim();
							} catch (e) {}
						}
					});
				}

				var msg;
				try {
					msg = JSON.parse(payload);
				} catch (e) {
					finish('The MCP server did not answer with JSON');
					return;
				}

				finish(msg.error ? (msg.error.message || 'MCP error') : null, msg.result);
			});
		});

		req.on('timeout', () => req.destroy(new Error('The MCP server did not answer in time')));
		req.on('error', err => finish(err.message));
		req.end(data);
	}

	return {
		send: (method, params, timeout, callback) => post({ jsonrpc: '2.0', id: ++counter, method: method, params: params || {} }, timeout, callback),
		notify: (method, params) => post({ jsonrpc: '2.0', method: method, params: params || {} }, 5000, NOOP),
		close: NOOP
	};
}

// ---------------------------------------------------------------------------------------------------------------------

function toolname(server, name) {
	return (server + '__' + name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
}

// Starts one server, shakes hands and lists its tools. callback(err, { transport, tools: [{ name, description, inputSchema }] })
function open(name, config, run, callback) {

	var transport = config.url ? http(config) : stdio(config, run.root, run.sessionid);

	transport.send('initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'totem', version: CONF.version } }, 15000, function(err) {

		if (err) {
			transport.close();
			callback(err);
			return;
		}

		transport.notify('notifications/initialized');

		transport.send('tools/list', {}, 15000, function(err, result) {

			if (err) {
				transport.close();
				callback(err);
				return;
			}

			var tools = (result && result.tools) || [];

			// Prompts are optional: a server without them answers with an error, which is not one
			transport.send('prompts/list', {}, 10000, function(err, listed) {
				callback(null, { transport: transport, tools: tools, prompts: err ? [] : ((listed && listed.prompts) || []) });
			});
		});
	});
}

// Connects the servers of the project that the user allows. They are kept in run.mcp until close().
exports.connect = function(run, callback) {

	var servers = exports.servers(run.root);
	var names = Object.keys(servers);

	run.mcp = { clients: [], tools: {}, defs: [], notes: [], prompts: {} };

	if (!names.length) {
		callback();
		return;
	}

	names.wait(function(name, next) {

		var config = servers[name];

		if (!config || (!config.command && !config.url)) {
			next();
			return;
		}

		MODS.permissions.check(run, 'mcp-start', { command: name + ': ' + label(config) }, function(reply) {

			if (reply !== 'allow') {
				run.mcp.notes.push(name + ' was not started');
				next();
				return;
			}

			open(name, config, run, function(err, client) {

				if (err) {
					run.mcp.notes.push('{0} failed: {1}'.format(name, err));
					next();
					return;
				}

				run.mcp.clients.push(client);

				// A server can offer fewer tools than it has: each tool costs tokens in every request, and a small model reads less well with many
				if (Array.isArray(config.tools))
					client.tools = client.tools.filter(t => config.tools.indexOf(t.name) !== -1);

				for (var tool of client.tools) {
					var id = toolname(name, tool.name);
					run.mcp.tools[id] = { server: name, tool: tool.name, client: client };
					run.mcp.defs.push({ type: 'function', function: { name: id, description: '[{0}] {1}'.format(name, tool.description || tool.name), parameters: tool.inputSchema || { type: 'object', properties: {} } } });
				}

				for (var prompt of (client.prompts || []))
					run.mcp.prompts[name + ':' + prompt.name] = { server: name, prompt: prompt, client: client };

				next();
			});
		});

	}, function() {

		// One tool for every prompt of the servers: the model sees the list in its description
		var ids = Object.keys(run.mcp.prompts);

		if (ids.length) {
			var text = ids.map(id => '{0}{1}'.format(id, run.mcp.prompts[id].prompt.description ? (' (' + run.mcp.prompts[id].prompt.description + ')') : '')).join('; ');
			run.mcp.defs.push({ type: 'function', function: { name: 'mcp_prompt', description: 'Gets a prompt (instructions or a template) that a connected MCP server offers. Available: ' + text, parameters: { type: 'object', properties: { name: { type: 'string', description: 'server:prompt' }, arguments: { type: 'object', description: 'Arguments of the prompt, as text values' } }, required: ['name'] } } });
		}

		callback();
	});
};

// callback(err, text) with the messages of a prompt
exports.prompt = function(run, name, args, callback) {

	var item = run.mcp && run.mcp.prompts[name];

	if (!item) {
		callback('Unknown prompt: ' + name);
		return;
	}

	item.client.transport.send('prompts/get', { name: item.prompt.name, arguments: args || {} }, 30000, function(err, result) {

		if (err) {
			callback(err);
			return;
		}

		callback(null, ((result && result.messages) || []).map(m => m.content && m.content.type === 'text' ? m.content.text : '[' + ((m.content && m.content.type) || 'content') + ']').join('\n\n'));
	});
};

// callback(err, text)
exports.call = function(run, id, args, callback, timeout) {

	var item = run.mcp && run.mcp.tools[id];

	if (!item) {
		callback('Unknown tool: ' + id);
		return;
	}

	item.client.transport.send('tools/call', { name: item.tool, arguments: args || {} }, timeout || 60000, function(err, result) {

		if (err) {
			callback(err);
			return;
		}

		var text = ((result && result.content) || []).map(c => c.type === 'text' ? c.text : '[' + c.type + ']').join('\n');

		if (result && result.isError)
			callback(text || 'The tool failed');
		else
			callback(null, text);
	});
};

exports.close = function(run) {
	if (run.mcp) {
		run.mcp.clients.forEach(client => client.transport.close());
		run.mcp = null;
	}
};
