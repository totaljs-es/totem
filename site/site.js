// The copy buttons: a command or a block of code goes to the clipboard.
(function() {

	var COPY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
	var CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

	function copy(text, button) {

		function done() {
			var before = button.innerHTML;
			button.innerHTML = CHECK;
			setTimeout(function() {
				button.innerHTML = before;
			}, 1500);
		}

		if (navigator.clipboard && window.isSecureContext)
			navigator.clipboard.writeText(text).then(done, function() {});
		else {
			var area = document.createElement('textarea');
			area.value = text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			try {
				document.execCommand('copy');
				done();
			} catch (e) {}
			document.body.removeChild(area);
		}
	}

	document.addEventListener('click', function(event) {
		var button = event.target.closest && event.target.closest('.tm-copy');
		if (!button)
			return;
		var box = button.closest('.tm-cmd, .code');
		var code = box && box.querySelector('code');
		code && copy(code.textContent.replace(/\n$/, ''), button);
	});

	// A code block gets its button
	document.querySelectorAll('.doc .code').forEach(function(block) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'tm-copy';
		button.title = 'Copy the code';
		button.setAttribute('aria-label', 'Copy the code');
		button.innerHTML = COPY;
		block.appendChild(button);
	});
})();
