// One person uses this application on their own computer (the config binds it to 127.0.0.1), so every request is this user.
// An application that other people reach needs a real check here: see the token of apps/contacts.
const USER = { id: 'local', name: 'Local', sa: true, permissions: [] };

AUTH(function($) {
	$.success(USER);
});
