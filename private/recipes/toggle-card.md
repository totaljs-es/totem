---
title: A message card with a show/hide button in jComponent 20
keywords: tarjeta, card, message, mensaje, toggle, hide, ocultar, mostrar, componente, component
strong: toggle
---
A message card keeps its bound message separate from its visible state. Clicking toggles visibility; it must NOT overwrite the message with true/false. self.find() returns jQuery: use .text(), .toggle(), not .textContent or .style. Use the component name the user requested. If asked for a complete HTML page, adapt this complete document and return it in one fenced html block, keeping the component from the previous request. No placeholder div or TOTAL.Component constructor is needed. If asked only for the component, show its COMPONENT declaration and ui-component markup.

`index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>@(Message card)</title>
	<link rel="stylesheet" href="https://cdn.componentator.com/spa.min@20.css" />
	<script src="https://cdn.componentator.com/spa.min@20.js"></script>
</head>
<body>
	<ui-component name="message-card" path="app.message"></ui-component>
	<script>
		COMPONENT('message-card', function(self, config) {
			var visible = true;
			self.make = function() {
				self.html('<section><p class="message"></p><button type="button">@(Hide)</button></section>');
				self.event('click', 'button', function() {
					visible = !visible;
					self.find('.message').toggle(visible);
					self.find('button').text(visible ? '@(Hide)' : '@(Show)');
				});
			};
			self.setter = function(value) {
				self.find('.message').text(value == null ? '' : value);
			};
		});
		var app = { message: 'Hello Total.js' };
	</script>
</body>
</html>
```

In a Total.js view, @(English) is a server translation marker. For a standalone HTML file opened directly, use normal translated text instead of server markers. The message is inserted with .text(), so markup in the bound value is displayed safely.
