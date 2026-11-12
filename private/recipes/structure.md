---
title: Project structure, FUNC, MAIN and MODS
keywords: structure, folders, folder, project, new, create, estructura, carpetas, proyecto, func, main, mods, module, modules, modulo, helper, helpers, shared, state, definitions, index.js, package.json
strong: func, mods, definitions, structure, estructura, index.js
---
A Total.js 5 project: `index.js`, `config`, `package.json` (dependency `total5`) and the folders `controllers/` (routes), `schemas/` (actions), `definitions/` (startup code, `AUTH`), `modules/` (shared code), `plugins/`, `views/`, `public/`, `resources/`.

The start script is always the official one of Total.js 5, whole and unchanged:

```js
// index.js
// ===================================================
// Total.js v5 start script
// https://www.totaljs.com
// ===================================================

require('total5');

const options = {};

// options.ip = '127.0.0.1';
// options.port = parseInt(process.argv[2]);
// options.unixsocket = PATH.join(F.tmpdir, 'app_name.socket');
// options.unixsocket777 = true;
// options.config = { name: 'Total.js' };
// options.sleep = 3000;
// options.inspector = 9229;
// options.watch = ['private'];
// options.livereload = 'https://yourhostname';
// options.watcher = false; // disables watcher
// options.edit = 'wss://www.yourcodeinstance.com/?id=projectname'
// options.editmcp = 'https://yourtotalmcpserverinstance.com/?id=admin'

options.release = process.argv.includes('--release');

// Service mode:
options.servicemode = process.argv.includes('--service') || process.argv.includes('--servicemode');
// options.servicemode = 'definitions,modules,config';

// Cluster:
// options.tz = 'utc';
// options.cluster = 'auto';
// options.limit = 10; // max 10. threads (works only with "auto" scaling)

Total.run(options);
```

```js
// definitions/func.js: a shared helper
FUNC.title = function(text) {
	return (text || '').trim().substring(0, 48);
};

// definitions/main.js: shared state
MAIN.running = {};
```

```js
// modules/mailer.js: used as MODS.mailer.send(...)
exports.id = 'mailer';

exports.send = function(email, text) {
	// ...
};
```

Shared helpers go in `FUNC`, shared state in `MAIN`, and the modules of the application are used through `MODS`, never with `require()`.
