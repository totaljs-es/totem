---
title: Use a module of the application: MODS
keywords: use, call, import, load, from, action, reuse, usar, llamar
strong: mods, module, modules, modulo, módulo
---
A file of `modules/` is used through `MODS`, with its `id`. There is no `require()` and no `import`:

```js
// modules/mailer.js
exports.id = 'mailer';

exports.send = function(email, text) {
	// ...
};
```

```js
// actions/users.js: in an action
NEWACTION('Users|invite', {
	name: 'Invite a user',
	input: '*email:String',
	action: function($, model) {
		MODS.mailer.send(model.email, 'Welcome');
		$.success();
	}
});
```
