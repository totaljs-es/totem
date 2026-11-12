exports.install = function() {
	ROUTE('+GET /', index);
};

// The page of the application: the layout gets the plugins that the user can see, in the order of their position
function index($) {

	var plugins = [];

	for (var key in F.plugins) {
		var item = F.plugins[key];
		if (!item.visible || item.visible($.user))
			plugins.push({ id: item.id, name: TRANSLATE($.language, item.name), icon: item.icon, position: item.position || 0 });
	}

	plugins.quicksort('position');
	$.view('index', plugins);
}
