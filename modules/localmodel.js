// Totem 4B on this computer, run by llama.cpp and managed by Totem: one button downloads the model and llama-server (the official build of
// llama.cpp for this system, unless llama-server is already installed), checks both by their SHA-256, starts the server on 127.0.0.1 and adds
// it as the provider "Totem 4B". The files live in the data folder (localmodel/). Nothing is downloaded or started without the button.
// The versions and the checksums are pinned in private/localmodel.json.

exports.id = 'localmodel';

var INFO = null;
var CHILD = null;
var STATE = MAIN.localmodel = { status: '', step: '', received: 0, total: 0, error: '', port: 0 };
// The provider "totem" with the model "4b": the selector shows it as totem:4b
var PROVIDER = 'totem';

function info() {
	return INFO || (INFO = Total.Fs.readFileSync(PATH.private('localmodel.json'), 'utf8').parseJSON());
}

function dir(name) {
	return PATH.databases('localmodel' + (name ? ('/' + name) : ''));
}

function platform() {
	return process.platform + '-' + process.arch;
}

exports.modelfile = function() {
	return dir('models/' + info().model.file);
};

// What was installed and whether it should run: { enabled, model: sha256 of the checked model, engine: path of the downloaded llama-server }
function saved() {
	try {
		return Total.Fs.readFileSync(dir('state.json'), 'utf8').parseJSON() || {};
	} catch (e) {
		return {};
	}
}

function save(data) {
	Total.Fs.mkdirSync(dir(), { recursive: true });
	Total.Fs.writeFileSync(dir('state.json'), JSON.stringify(Object.assign(saved(), data)));
}

function executable(file) {
	try {
		return Total.Fs.statSync(file).isFile();
	} catch (e) {
		return false;
	}
}

// llama-server: the one of the config, the one installed on this computer (Homebrew, a build of llama.cpp), or the one that Totem downloaded
exports.engine = function() {

	var name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

	if (CONF.llamaserver)
		return executable(CONF.llamaserver) ? { path: CONF.llamaserver, source: 'config' } : null;

	var dirs = (process.env.PATH || '').split(Total.Path.delimiter).filter(Boolean);
	for (var item of dirs) {
		var file = Total.Path.join(item, name);
		if (executable(file))
			return { path: file, source: 'system' };
	}

	var own = saved().engine;
	return own && executable(own) ? { path: own, source: 'downloaded' } : null;
};

exports.installed = function() {
	return saved().model === info().model.sha256 && executable(exports.modelfile());
};

exports.status = function() {
	var model = info().model;
	var engine = exports.engine();
	return {
		name: model.name,
		version: model.version,
		size: model.size,
		supported: !!(engine || info().llamacpp.platforms[platform()]),
		installed: exports.installed(),
		engine: engine ? engine.source : '',
		enabled: !!saved().enabled,
		running: STATE.status === 'running',
		status: STATE.status,
		step: STATE.step,
		progress: STATE.total ? Math.floor(STATE.received / STATE.total * 100) : 0,
		error: STATE.error,
		url: STATE.port ? ('http://127.0.0.1:' + STATE.port + '/v1') : ''
	};
};

// A file of the internet to a file of the disk, with its SHA-256 checked before it gets its name. The redirects of Hugging Face and GitHub are
// followed. onprogress(received)
function download(url, file, sha256, onprogress, callback) {

	var part = file + '.part';
	var redirects = 0;

	Total.Fs.mkdirSync(Total.Path.dirname(file), { recursive: true });

	(function get(address) {

		var lib = /^https:/.test(address) ? Total.Https : Total.Http;

		lib.get(address, { headers: { 'user-agent': 'Total.js Totem' } }, function(res) {

			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				if (++redirects > 8) {
					callback('@(Too many redirects)');
					return;
				}
				get(new URL(res.headers.location, address).toString());
				return;
			}

			if (res.statusCode !== 200) {
				res.resume();
				callback('@(The download failed) (HTTP ' + res.statusCode + ')');
				return;
			}

			var hash = Total.Crypto.createHash('sha256');
			var out = Total.Fs.createWriteStream(part);
			var received = 0;
			var failed = false;

			res.on('data', function(chunk) {
				hash.update(chunk);
				received += chunk.length;
				onprogress && onprogress(received);
			});

			res.on('error', function(err) {
				failed = true;
				out.destroy();
				callback(err.message);
			});

			out.on('error', function(err) {
				if (!failed) {
					failed = true;
					res.destroy();
					callback(err.message);
				}
			});

			out.on('finish', function() {
				if (failed)
					return;
				if (hash.digest('hex') !== sha256) {
					Total.Fs.rmSync(part, { force: true });
					callback('@(The downloaded file is not the expected one)');
					return;
				}
				Total.Fs.rename(part, file, err => callback(err ? err.message : null));
			});

			res.pipe(out);

		}).on('error', err => callback(err.message));

	})(url);
}

exports.download = download;

function find(folder, name) {
	var list;
	try {
		list = Total.Fs.readdirSync(folder, { withFileTypes: true });
	} catch (e) {
		return '';
	}
	for (var entry of list) {
		var file = Total.Path.join(folder, entry.name);
		if (entry.isFile() && entry.name === name)
			return file;
		if (entry.isDirectory()) {
			var found = find(file, name);
			if (found)
				return found;
		}
	}
	return '';
}

// The build of llama.cpp for this system: downloaded, checked, unpacked (tar opens the .tar.gz and, on Windows, the .zip)
function installengine(callback) {

	var build = info().llamacpp.platforms[platform()];

	if (!build) {
		callback('@(There is no build of llama.cpp for this system. Install llama-server and start Totem again.)');
		return;
	}

	var archive = dir('download/' + build.url.split('/').pop());
	var target = dir('engine/' + info().llamacpp.build);

	STATE.step = 'engine';
	STATE.received = 0;
	STATE.total = build.size;

	download(build.url, archive, build.sha256, received => STATE.received = received, function(err) {

		if (err) {
			callback(err);
			return;
		}

		Total.Fs.rmSync(target, { recursive: true, force: true });
		Total.Fs.mkdirSync(target, { recursive: true });

		Total.Child.execFile('tar', [/\.zip$/.test(archive) ? '-xf' : '-xzf', archive, '-C', target], { timeout: 120000 }, function(err) {

			Total.Fs.rm(archive, { force: true }, NOOP);

			if (err) {
				callback('@(The build of llama.cpp could not be unpacked)');
				return;
			}

			var server = find(target, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');

			if (!server) {
				callback('@(The build of llama.cpp has no llama-server)');
				return;
			}

			process.platform !== 'win32' && Total.Fs.chmodSync(server, 493);
			save({ engine: server });
			callback();
		});
	});
}

function installmodel(callback) {

	var model = info().model;

	STATE.step = 'model';
	STATE.received = 0;
	STATE.total = model.size;

	download(model.url, exports.modelfile(), model.sha256, received => STATE.received = received, function(err) {
		if (err) {
			callback(err);
			return;
		}
		save({ model: model.sha256 });
		callback();
	});
}

// Downloads what is missing and starts it. It works in the background: the interface follows it with status().
// Not called "install": Total.js runs the install() of every module when it starts.
exports.prepare = function() {

	if (STATE.status === 'downloading' || STATE.status === 'starting')
		return false;

	STATE.status = 'downloading';
	STATE.error = '';

	var fail = function(err) {
		STATE.status = 'error';
		STATE.step = '';
		STATE.error = err;
	};

	var model = function() {
		if (exports.installed())
			start();
		else
			installmodel(err => err ? fail(err) : start());
	};

	var start = function() {
		save({ enabled: true });
		exports.start(err => err && fail(err));
	};

	if (exports.engine())
		model();
	else
		installengine(err => err ? fail(err) : model());

	return true;
};

function provider(enabled, callback) {

	var model = info().model;
	var meta = {};

	meta[model.id] = { id: model.id, name: model.name, context: model.context, tools: true, reasoning: false, totem: true };

	var data = { name: 'Totem', url: 'http://127.0.0.1:' + (STATE.port || CONF.localmodelport || 8091) + '/v1', kind: 'openai', icon: 'totem', models: [model.id], meta: meta, disabled: !enabled, newmodels: false, managed: true, dtupdated: NOW };

	NOSQL('providers').read().where('id', PROVIDER).callback(function(err, item) {
		var done = () => FUNC.providers(() => callback && callback());
		if (item)
			NOSQL('providers').modify(data).where('id', PROVIDER).callback(done);
		else {
			data.id = PROVIDER;
			data.key = '';
			data.dtcreated = NOW;
			NOSQL('providers').insert(data).callback(done);
		}
	});
}

function health(port, callback) {
	Total.Http.get('http://127.0.0.1:' + port + '/health', function(res) {
		res.resume();
		callback(res.statusCode === 200);
	}).on('error', () => callback(false));
}

// Starts llama-server with the model, waits until it has loaded it and turns the provider on. callback(err)
exports.start = function(callback) {

	if (CHILD) {
		callback && callback();
		return;
	}

	var engine = exports.engine();

	if (!engine || !exports.installed()) {
		callback && callback('@(Totem 4B is not installed)');
		return;
	}

	var port = STATE.port = CONF.localmodelport || 8091;
	var args = ['-m', exports.modelfile(), '--jinja', '--host', '127.0.0.1', '--port', '' + port, '-c', '' + info().model.context];
	var tail = '';

	STATE.status = 'starting';
	STATE.step = '';
	STATE.error = '';

	CHILD = Total.Child.spawn(engine.path, args, { cwd: Total.Path.dirname(engine.path), stdio: ['ignore', 'ignore', 'pipe'] });
	CHILD.stderr.on('data', chunk => tail = (tail + chunk).slice(-2000));

	var child = CHILD;
	var answered = false;
	var finish = function(err) {
		if (!answered) {
			answered = true;
			callback && callback(err);
		}
	};

	child.on('error', function(err) {
		CHILD === child && (CHILD = null);
		STATE.status = 'error';
		STATE.error = err.message;
		finish(err.message);
	});

	child.on('exit', function(code) {
		CHILD === child && (CHILD = null);
		if (STATE.status !== 'stopped') {
			STATE.status = 'error';
			STATE.error = '@(llama-server stopped) (' + code + '): ' + tail.trim().split('\n').slice(-3).join(' ');
			provider(false);
		}
		finish(STATE.error);
	});

	var started = Date.now();

	(function wait() {
		if (CHILD !== child)
			return;
		health(port, function(ok) {
			if (CHILD !== child)
				return;
			if (ok) {
				STATE.status = 'running';
				provider(true, () => finish());
				return;
			}
			if (Date.now() - started > 180000) {
				exports.stop();
				STATE.status = 'error';
				STATE.error = '@(llama-server did not load the model in time)';
				finish(STATE.error);
				return;
			}
			setTimeout(wait, 500);
		});
	})();
};

// Stops the server. With `forget`, it does not start again with Totem.
exports.stop = function(forget, callback) {
	forget && save({ enabled: false });
	STATE.status = 'stopped';
	if (CHILD) {
		CHILD.kill();
		CHILD = null;
	}
	provider(false, callback);
};

// Totem 4B starts with Totem when it was installed and not stopped by the user
ON('ready', function() {
	if (CONF.localmodel !== false && saved().enabled && exports.installed())
		exports.start(NOOP);
});

process.on('exit', function() {
	CHILD && CHILD.kill();
});
