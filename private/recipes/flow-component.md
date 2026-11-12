---
title: A Total.js Flow component
keywords: flow, flowstream, component, componente, exports.make, instance.message, inputs, outputs, readme, settings
strong: flow, flowstream
---
A component of Total.js Flow (FlowStream) is one HTML file. It is not a jComponent: there is no `COMPONENT()`. The server code goes in `<script total>`, and `<readme>`, `<settings>` and `<body>` describe it in the designer. Without a path from the user the file is `components/<id>.html`.

```html
<!-- components/uppercase.html -->
<script total>

	exports.id = 'uppercase';
	exports.name = 'Uppercase';
	exports.icon = 'ti ti-font';
	exports.author = 'Total.js';
	exports.version = '1';
	exports.group = 'Common';
	exports.config = { field: 'name' };
	exports.inputs = [{ id: 'input', name: 'Input' }];
	exports.outputs = [{ id: 'output', name: 'Output' }, { id: 'error', name: 'Error' }];

	exports.make = function(instance, config) {
		instance.message = function($) {
			var data = $.data;
			if (data && typeof(data[config.field]) === 'string') {
				data[config.field] = data[config.field].toUpperCase();
				$.send('output', data);
			} else
				$.send('error', 'The field must be a string');
		};
	};

</script>

<readme>
Changes the text of a field to upper case.
- __Input__: {Object}
- __Output__: {Object}
</readme>

<settings>
	<div class="padding">
		<ui-component name="input" path="?.field" config="required:1"><b>Field</b></ui-component>
	</div>
</settings>

<body>
	<header>
		<i class="ICON"></i>NAME
	</header>
</body>
```

`exports.inputs` and `exports.outputs` are the connectors; a component that only starts a flow has no inputs and one that only ends it has no outputs. `instance.message` receives every message: `$.data` is its data, `$.send(output id, data)` passes it on and `$.destroy()` ends it. `config` holds the values of `exports.config`, which the form in `<settings>` edits with `path="?.field"`.
