---
title: Scheduled work: CRON and the service event
keywords: cron, schedule, scheduled, timer, interval, every, midnight, daily, hourly, job, jobs, task, tarea, programar, diario, cada
strong: cron, schedule, scheduled
---
Work that starts by itself goes in a file of `definitions/`. `ON('service')` is for "every N minutes" and `CRON('minute hour day month weekday', function)` for a time of the day or of the week.

```js
// definitions/jobs.js

// The framework emits "service" every minute, with the number of minutes since the start
ON('service', function(counter) {
	if (counter % 5 === 0)
		ACTION('Reports|refresh').callback(ERROR('Reports|refresh'));
});

// Every day at midnight
CRON('0 0 * * *', function() {
	// ...
});

// At the minutes 0, 15, 30 and 45 of every hour
CRON('0,15,30,45 * * * *', function() {
	// ...
});
```

Put the work in an action and let the schedule only call it: the same code can then run from the API and be tested without waiting. A step works too: `*/5 * * * *` is every five minutes. Do not use `setInterval` or `node-cron`.
