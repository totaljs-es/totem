---
title: Starting an application: where to begin
keywords: app, apps, application, aplicacion, aplicación, proyecto, project, nueva, nuevo, new, tareas, tasks, todo, api, empezar, empiezo, empezando, start, begin, scratch, cero, build, construir, hacer
strong: empiez*, empezar, scratch, begin, starting, desde cero
---
For a clear request to create an application in Build mode, create the files with the write tool. Do not stop at a plan, and do not ask which file to write first. For Plan mode show the files without writing them. Keep every file in its own fenced block with its path on the line before it, exactly as below; never put package.json, index.js and a controller into the same JavaScript block.

These four files make a working minimal Total.js 5 application. Adapt the route and response to the request. The framework loads controllers/ automatically: do not require the controller from index.js. Only index.js requires total5; the rest uses the initialized framework. Add actions in schemas/ when the requested features need them. Leave out authentication unless requested, so the first route can be used.

`package.json`

```json
{
	"name": "hello-app",
	"version": "1.0.0",
	"private": true,
	"scripts": { "start": "node index.js" },
	"dependencies": { "total5": "0.0.20-1" }
}
```

`index.js`

```js
require('total5');

var options = {};
F.run(options);
```

`config`

```text
name                        : Hello app
version                     : 1.0.0
```

`controllers/default.js`

```js
exports.install = function() {
	ROUTE('GET /hello', hello);
};

function hello($) {
	$.plain('Hello');
}
```

After creating the files, run npm install and npm start (with the command permission), then request GET /hello to verify the actual response. Never claim that the app was tested if no command or request ran.
