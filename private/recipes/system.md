---
title: System information: memory, CPU, uptime with Total.Os
keywords: memory, memoria, ram, freemem, totalmem, cpu, cpus, uptime, hostname, platform, system, sistema, os, load, loadavg, free, libre, info
strong: freemem, totalmem, memory, memoria, ram, cpu, uptime, loadavg
---
The system information comes from `Total.Os` (the `os` module of Node.js; never `require('os')` or `process.memoryUsage()`, which is the memory of this process only). An action that answers it, with its route:

```js
// actions/system.js
NEWACTION('System|memory', {
	name: 'Free memory of the system',
	action: function($) {
		var total = Total.Os.totalmem();
		var free = Total.Os.freemem();
		$.callback({ total: total, free: free, used: total - free });
	}
});
```

```js
// controllers/api.js
exports.install = function() {
	ROUTE('+API ? -system_memory --> System|memory');
};
```

Other values: `Total.Os.cpus().length`, `Total.Os.uptime()`, `Total.Os.hostname()`, `Total.Os.platform()`, `Total.Os.loadavg()`.
