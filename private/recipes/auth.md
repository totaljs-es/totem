---
title: Authentication: AUTH and the + and - routes
keywords: autentic*, proteg*, protej*, usuari*, sesi*, permis*, contrase*, auth, authentication, authenticate, login, signin, user, users, session, token, protect, authorize, permission, permissions, autenticacion, sesion, proteger
strong: auth, authentication, autenticacion, authorize, autentic*
---
`AUTH()` runs for every request and decides who the user is. It is in a file of `definitions/`.

```js
// definitions/auth.js
AUTH(function($) {

	var token = $.headers['x-token'] || $.cookie('session');
	var user = MAIN.sessions[token];

	if (user)
		$.success(user);
	else
		$.invalid();
});
```

A route that starts with `+` needs a signed in user, one that starts with `-` is only for users that are not signed in, and without a sign is for everybody:

```js
ROUTE('+GET /account', account);
ROUTE('-GET /login', login);
```

Inside an action the user is `$.user`.
