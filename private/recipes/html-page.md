---
title: A complete HTML page with jComponent 20
keywords: html, complete, completo, completa, entero, standalone, page, pagina, página, mostrar, muestre, componente, component
strong: standalone
---
For a request for a complete HTML page, return ONE fenced html code block, not raw HTML. Adapt the component to the user's request and the preceding conversation. Include the component implementation, not just a placeholder. Use this document structure. The URLs are HTTPS, so the page also works when opened from disk. The runtime is jComponent 20; custom components use COMPONENT and ui-component, never new TOTAL.Component or component.load().

`index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>@(Counter)</title>
	<link rel="stylesheet" href="https://cdn.componentator.com/spa.min@20.css" />
	<script src="https://cdn.componentator.com/spa.min@20.js"></script>
</head>
<body>
	<ui-component name="counter" path="app.count" config="step:1"></ui-component>
	<script>
		COMPONENT('counter', 'step:1', function(self, config) {
			self.make = function() {
				self.html('<button type="button">@(Add)</button> <b class="value">0</b>');
				self.event('click', 'button', function() {
					self.set((self.get() || 0) + config.step);
				});
			};
			self.setter = function(value) {
				self.find('.value').text(value || 0);
			};
		});
		var app = { count: 0 };
	</script>
</body>
</html>
```

In a Total.js view, @(English text) is translated by the server; for a standalone file opened directly in the browser, use ordinary user-facing text instead. Keep the same component name, value and behaviour requested in previous turns.
