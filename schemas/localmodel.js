NEWACTION('Localmodel|status', {
	name: 'Totem 4B on this computer: installed, downloading, running',
	action: function($) {
		var status = MODS.localmodel.status();
		status.error = status.error ? TRANSLATE($.language, status.error) : '';
		$.callback(status);
	}
});

NEWACTION('Localmodel|install', {
	name: 'Download Totem 4B and llama.cpp, and start them',
	action: function($) {
		if (!MODS.localmodel.status().supported) {
			$.invalid('@(There is no build of llama.cpp for this system. Install llama-server and start Totem again.)');
			return;
		}
		MODS.localmodel.prepare();
		$.success();
	}
});

NEWACTION('Localmodel|stop', {
	name: 'Stop Totem 4B',
	action: function($) {
		MODS.localmodel.stop(true, () => $.success());
	}
});
