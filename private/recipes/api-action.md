---
title: An API route and its action
keywords: api, action, actions, newaction, schema, schemas, crud, list, create, input, validation, accion, acciones, esquema, rest, resource
strong: newaction, action, actions, accion, acción, acciones
---
For an API, the logic is an action (`NEWACTION` in `schemas/`) and the route points to it. The name of an action has a pipe: `Collection|verb`.

```js
// schemas/tickets.js
NEWACTION('Tickets|list', {
	name: 'List tickets',
	action: async function($) {
		var items = await DATA.find('nosql/tbl_ticket').promise($);
		$.callback(items);
	}
});

NEWACTION('Tickets|create', {
	name: 'Create a ticket',
	input: '*name:String, note:String',
	action: async function($, model) {
		model.id = UID();
		model.dtcreated = NOW;
		await DATA.insert('nosql/tbl_ticket', model).promise($);
		$.success(model.id);
	}
});
```

```js
// controllers/api.js: POST /api/ with { "schema": "tickets" }
exports.install = function() {
	ROUTE('+API ? -tickets --> Tickets|list');
	ROUTE('+API ? +tickets_create --> Tickets|create');
};
```

`input` lists the fields of the body (`*` is required), `params: '*id'` the fields of the url and `query` the query string. The action receives the validated body as `model`.
