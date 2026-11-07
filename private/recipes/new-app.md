---
title: Starting an application: where to begin
keywords: app, apps, application, aplicacion, aplicación, proyecto, project, nueva, nuevo, new, tareas, tasks, todo, api, empezar, empiezo, empezando, start, begin, scratch, cero, build, construir, hacer
strong: empiez*, empezar, scratch, begin, starting, desde cero
---
A new application is built in this order, one file at a time. Do not write all of it at once: list these steps and ask which one to write first.

1. `package.json` with the dependency `total5`, and `index.js`.
2. `config` with the settings (`name`, `version`).
3. An action in `schemas/` for each thing the application does (`Tasks|list`, `Tasks|create`).
4. The routes in `controllers/` that point to the actions.
5. `definitions/auth.js` when it needs users.

```js
// index.js
require('total5');
F.run({});
```

```js
// schemas/tasks.js
NEWACTION('Tasks|list', {
	name: 'List tasks',
	action: async function($) {
		var items = await NOSQL('tasks').find().promise($);
		$.callback(items);
	}
});

NEWACTION('Tasks|create', {
	name: 'Create a task',
	input: '*name:String',
	action: async function($, model) {
		model.id = UID();
		model.dtcreated = NOW;
		await NOSQL('tasks').insert(model).promise($);
		$.success(model.id);
	}
});
```

```js
// controllers/api.js
exports.install = function() {
	ROUTE('+API ? -tasks --> Tasks|list');
	ROUTE('+API ? +tasks_create --> Tasks|create');
};
```
