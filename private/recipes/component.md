---
title: A jComponent 20 component
keywords: jcomponent, component, components, componente, ui-component, tangular, self.make, setter, counter, widget
strong: jcomponent, component, componente, ui-component
---
jComponent 20 is the user interface library of Total.js for the browser. A component is `COMPONENT(name, default config, declaration)` and is used with `<ui-component>`. Write one only when there is no component for it.

```js
COMPONENT('counter', 'step:1', function(self, config) {

	self.make = function() {
		self.html('<button type="button">Add</button> <b class="value">0</b>');
		self.event('click', 'button', function() {
			self.set((self.get() || 0) + config.step);
		});
	};

	self.setter = function(value) {
		self.find('.value').text(value || 0);
	};
});
```

```html
<ui-component name="counter" path="cart.count" config="step:2"></ui-component>
```

`path` is the value that the component reads (`self.get()`, `setter`) and writes (`self.set()`).
