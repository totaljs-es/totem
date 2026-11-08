// Totem browser helpers

// Events from the server go to the chat plugin
ON('message', function(msg) {
	if (msg && msg.type && PLUGINS.chat && PLUGINS.chat.event)
		PLUGINS.chat.event(msg);
});

// Subscriptions are lost when the socket reconnects: the chat subscribes again
ON('online', function(is) {
	if (is && PLUGINS.chat && PLUGINS.chat.online)
		PLUGINS.chat.online();
});

// Tokens used by the model in a session, from the steps of its messages
Thelpers.tokens = function(items) {
	var total = 0;
	var cost = 0;
	(items || []).forEach(function(m) {
		(m.parts || []).forEach(function(p) {
			if (p.type === 'step' && p.data && p.data.tokens)
				total += (p.data.tokens.input || 0) + (p.data.tokens.output || 0);
			if (p.type === 'step' && p.data && p.data.cost)
				cost += p.data.cost;
		});
	});
	return total ? (total.format(0) + ' tokens' + (cost ? (' · $' + (cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2))) : '')) : '';
};

// The knowledge that was used for a prompt: the pages of Forge as links, the recipes of Totem as text
Thelpers.forgepages = function(pages) {
	return (pages || []).map(function(p) {
		return p.url ? ('<a href="' + Thelpers.encode(p.url) + '" target="_blank" rel="noopener">' + Thelpers.encode(p.title) + '</a>') : ('<span>' + Thelpers.encode(p.title) + '</span>');
	}).join(' · ');
};

Thelpers.shortpath = function(path) {
	if (!path)
		return '';
	var arr = path.split('/');
	return arr.length > 3 ? ('.../' + arr.slice(-2).join('/')) : path;
};

Thelpers.json = function(value) {
	if (value == null)
		return '';
	return Thelpers.encode(typeof(value) === 'string' ? value : JSON.stringify(value, null, 2));
};

// A unified patch as lines with a class per kind of line
Thelpers.diffhtml = function(patch) {
	if (!patch)
		return '';
	return patch.split('\n').map(function(line) {
		var type = line.charAt(0) === '+' ? 'add' : (line.charAt(0) === '-' ? 'del' : (line.indexOf('@@') === 0 ? 'hunk' : ''));
		return '<span' + (type ? (' class="' + type + '"') : '') + '>' + Thelpers.encode(line || ' ') + '</span>';
	}).join('');
};

// Theme: "auto" follows the system, "light" and "dark" are the choice of the user. The class ui-dark of the body is the one of IntranetCSS.
var THEME = {};

THEME.mode = function() {
	try {
		return localStorage.getItem('totemtheme') || 'auto';
	} catch (e) {
		return 'auto';
	}
};

THEME.apply = function(mode) {

	mode = mode || THEME.mode();

	try {
		localStorage.setItem('totemtheme', mode);
	} catch (e) {}

	var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
	// The accent of the components (dialogs, focus, switches) is a soft coral; the own buttons of Totem are neutral
	APPEARANCE({ color: dark ? '#D97757' : '#C4623F', dark: dark });
	SET('common.theme', mode);
};

ON('ready', function() {

	THEME.apply();

	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
			if (THEME.mode() === 'auto')
				THEME.apply('auto');
		});
	}
});

// The icon of a provider (public/img/providers). A provider without one gets its initial.
var PROVICONS = { openai: 1, anthropic: 1, gemini: 1, mistral: 1, ollama: 1, deepseek: 1, openrouter: 1, lmstudio: 1, groq: 1, llamacpp: 1, together: 1, xai: 1, fireworks: 1, cerebras: 1, huggingface: 1, nvidia: 1, moonshot: 1, vllm: 1, cohere: 1, litellm: 1 };

Thelpers.provicon = function(icon, name, large) {
	var css = 'prov' + (large ? ' prov-large' : '');
	if (icon && PROVICONS[icon])
		return '<span class="' + css + '" style="--i:url(/img/providers/' + icon + '.svg)"></span>';
	return '<span class="' + css + ' mono">' + Thelpers.encode((name || '?').substring(0, 1).toUpperCase()) + '</span>';
};

// A unified patch as two columns: the old file on the left, the new one on the right. A block of removed lines is paired with the block of added lines that follows.
Thelpers.splitdiff = function(patch) {

	if (!patch)
		return '';

	var rows = [];
	var left = [];
	var right = [];
	var ol = 0;
	var nl = 0;

	var flush = function() {
		var count = Math.max(left.length, right.length);
		for (var i = 0; i < count; i++)
			rows.push({ l: left[i], r: right[i] });
		left = [];
		right = [];
	};

	patch.split('\n').forEach(function(line) {

		if (line.indexOf('@@') === 0) {
			flush();
			var m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
			ol = m ? +m[1] : 1;
			nl = m ? +m[2] : 1;
			rows.push({ hunk: line });
			return;
		}

		var c = line.charAt(0);
		var t = line.substring(1);

		if (c === '-')
			left.push({ n: ol++, t: t });
		else if (c === '+')
			right.push({ n: nl++, t: t });
		else {
			flush();
			rows.push({ l: { n: ol++, t: t }, r: { n: nl++, t: t }, ctx: true });
		}
	});

	flush();

	var cell = function(side, css) {
		return side ? ('<td class="n">' + side.n + '</td><td class="c ' + css + '">' + Thelpers.encode(side.t || ' ') + '</td>') : '<td class="n"></td><td class="c empty"></td>';
	};

	return '<div style="overflow:auto;max-height:420px"><table class="split">' + rows.map(function(row) {
		if (row.hunk)
			return '<tr class="hunk"><td colspan="4">' + Thelpers.encode(row.hunk) + '</td></tr>';
		return '<tr>' + cell(row.l, row.ctx ? '' : 'del') + cell(row.r, row.ctx ? '' : 'add') + '</tr>';
	}).join('') + '</table></div>';
};
