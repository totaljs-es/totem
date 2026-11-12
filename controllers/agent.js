// Totem for another agent: plain text in, a few lines of plain text out (schemas/agent.js)
exports.install = function() {
	// The guide has no secret and is what another agent is pointed at, so it needs no token; the rest does what the API does
	ROUTE('GET   /agent/', guide);
	// These two answer when the model ends, which is minutes: the wait of a request (up to 900 seconds) is under their timeout
	ROUTE('+POST /agent/project/ <16m', project, 1024 * 64);
	ROUTE('+POST /agent/build/ <16m', build);
	ROUTE('+GET  /agent/status/', status);
};

function answer($, name, data) {
	var caller = ACTION(name, data || {}).user($.user);
	$.query && caller.query($.query);
	caller.callback(function(err, text) {
		if (err) {
			$.response.status = 400;
			$.plain('error: ' + ((err.items && err.items[0] && err.items[0].error) || err.toString()));
		} else
			$.plain(text);
	});
}

function guide($) {
	answer($, 'Agent|guide');
}

function project($) {
	answer($, 'Agent|project', $.body);
}

function build($) {
	answer($, 'Agent|build', $.body);
}

function status($) {
	answer($, 'Agent|status');
}
