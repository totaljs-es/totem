// Totem for another agent (Claude Code, Codex, a script). The other agent writes the plan of an application and reviews the result; Totem
// writes the files with the model of this computer. Every answer is a few lines of plain text, because the other agent pays for what it reads.
//
//   GET  /agent/           how to use it (this is the address to give to the other agent)
//   POST /agent/project/   { path, text, model, wait }  text: the card of the application, or a request for the model to fill the card
//   POST /agent/build/     { path, model, wait }        makes the tasks that are not done, one by one
//   GET  /agent/status/    ?path=                       what is done
//
// The same is in the command line: totem project, totem build and totem plan.

var SESSIONNAME = 'Project';

// The session of the folder that these calls use: the last one with their name, or a new one
async function open($, path, model, create) {

	// The folder of a new application may not be there yet
	if (create) {
		try {
			Total.Fs.mkdirSync(Total.Path.resolve(path), { recursive: true });
		} catch (e) {
			throw new Error('the folder cannot be made: ' + path);
		}
	}

	var project = await ACTION('Projects|open', { path: path }).user($.user).promise($);
	var sessions = await NOSQL('sessions').find().where('projectid', project.id).where('name', SESSIONNAME).sort('dtcreated_desc').take(1).promise($);
	var session = sessions[0];

	if (!session) {
		model = model || Object.keys(F.aimodels).sort()[0];
		if (!model || !F.aimodels[model])
			throw new Error('no model: add a provider in Totem (Settings) or send "model" (provider:model)');
		session = await ACTION('Sessions|create', { projectid: project.id, model: model, name: SESSIONNAME }).user($.user).promise($);
	}

	return { project: project, session: session };
}

function seconds(value, fallback) {
	value = +value || fallback;
	return Math.max(1, Math.min(value, 900)) * 1000;
}

// Sends a prompt of the project to the session and waits until Totem ends it, or until the time is over: { ended, error }
async function send($, session, text, model, wait) {

	var result = { ended: false, error: '' };

	var done = MODS.project.wait(session.id).then(function(err) {
		result.ended = true;
		result.error = err ? FUNC.plain(err + '') : '';
	});

	if (text)
		await ACTION('Sessions|prompt', { text: text, model: model || '' }).params({ id: session.id }).user($.user).promise($);

	await Promise.race([done, new Promise(resolve => setTimeout(resolve, wait))]);
	return result;
}

function busy(session) {
	return !!(MAIN.running[session.id] || MAIN.building[session.id]);
}

// The text that Totem wrote last in the session: what is wrong with a card
async function lasttext(session) {
	var messages = await NOSQL('messages').find().where('sessionid', session.id).where('model', 'totem').sort('dtcreated_desc').take(1).promise();
	if (!messages.length)
		return '';
	var parts = await NOSQL('parts').find().where('messageid', messages[0].id).promise();
	return parts.filter(p => p.type === 'text' && p.data).map(p => p.data.text).join('\n');
}

NEWACTION('Agent|guide', {
	name: 'How another agent uses Totem',
	action: function($) {
		var models = Object.keys(F.aimodels).sort();
		$.callback([
			'Totem writes Total.js 5 applications with a model of this computer. You write the plan and review the result; Totem writes the files, which costs you nothing.',
			'',
			'1. Write the card of the application. A plugin is one kind of thing that it keeps, with its list and its form:',
			'',
			'APP: shop',
			'',
			'PLUGIN: products',
			'TITLE: Products',
			'ICON: ti ti-box',
			'FIELDS: *name:String, price:Number, isactive:Boolean',
			'',
			'   PLUGIN is one lowercase word in plural. FIELDS are name:Type, a * before a required one. Types: String, Number, Boolean, Date, Email, Phone, URL. No id and no dates: every row has them. At most 8 plugins.',
			'',
			'2. Send the card, then build. With a shell on this computer:',
			'',
			'   totem project "<the card>" --project <folder>',
			'   totem build --project <folder>',
			'',
			'   Without a shell, with HTTP (JSON body, plain text answer' + (CONF.token ? ', header x-token with the access token' : '') + '):',
			'',
			'   POST /agent/project/   { "path": "<folder>", "text": "<the card>" }',
			'   POST /agent/build/     { "path": "<folder>", "wait": 600 }',
			'   GET  /agent/status/?path=<folder>',
			'',
			'3. The answer is a few lines: "shop: 9 of 9 tasks done", or the task that failed and why. A build takes about a minute for each file of the model; when "wait" (seconds) is over the answer says "building": ask the status or send build again.',
			'4. Read the files only to review them. The names are in <folder>/.totem/project.md. Change the card and send it again to add a plugin: what is done stays.',
			'',
			'Models of this Totem: ' + (models.length ? models.join(', ') : 'none yet (add a provider in Settings)') + '. Send "model" to choose one.'
		].join('\n'));
	}
});

NEWACTION('Agent|project', {
	name: 'Set or make the plan of an application',
	input: '*path:String, *text:String, model:String, wait:Number',
	action: async function($, model) {

		var opened;

		try {
			opened = await open($, model.path, model.model, true);
		} catch (e) {
			$.invalid(e.message);
			return;
		}

		if (busy(opened.session)) {
			$.callback(MODS.project.status(MODS.project.load(opened.project.path), true));
			return;
		}

		var given = MODS.project.iscard(model.text);
		var before = MODS.project.load(opened.project.path);
		var sent = await send($, opened.session, '/project ' + model.text, model.model, seconds(model.wait, 180));

		if (!sent.ended) {
			$.callback('planning: the model has not answered yet; ask the status');
			return;
		}

		if (sent.error) {
			$.callback('error: the model ' + (model.model || opened.session.model) + ' could not make the plan: ' + sent.error);
			return;
		}

		var plan = MODS.project.load(opened.project.path);

		// No new plan: the card was not accepted, and Totem said why
		if (!plan || (before && before.dtcreated === plan.dtcreated)) {
			var said = (await lasttext(opened.session)).replace(/```[\s\S]*?```/g, '').replace(/\s*\n\s*/g, ' ').replace(/Send `\/project`.*$/, '').trim();
			$.callback('not accepted. ' + (said || 'The answer of the model was not a card.'));
			return;
		}

		var done = plan.tasks.filter(t => t.status === 'done').length;
		$.callback(plan.card.app + ': plan saved, ' + plan.card.plugins.length + ' plugin' + (plan.card.plugins.length === 1 ? '' : 's') + ', ' + plan.tasks.length + ' tasks' + (done ? ' (' + done + ' already done)' : '') + '. Next: build' + (given ? '' : '\n\n' + MODS.project.text(plan.card)));
	}
});

NEWACTION('Agent|build', {
	name: 'Build the tasks of the plan that are not done',
	input: '*path:String, model:String, wait:Number',
	action: async function($, model) {

		var opened;

		try {
			opened = await open($, model.path, model.model);
		} catch (e) {
			$.invalid(e.message);
			return;
		}

		var plan = MODS.project.load(opened.project.path);

		if (!plan) {
			$.callback(MODS.project.status(null));
			return;
		}

		// A build that is running is not started twice: the call waits for it
		var sent = await send($, opened.session, busy(opened.session) ? '' : '/build', model.model, seconds(model.wait, 300));
		$.callback(MODS.project.status(MODS.project.load(opened.project.path), !sent.ended && busy(opened.session)));
	}
});

NEWACTION('Agent|status', {
	name: 'What is done of the plan of a folder',
	query: '*path:String',
	action: async function($) {

		var opened;

		try {
			opened = await open($, $.query.path);
		} catch (e) {
			$.invalid(e.message);
			return;
		}

		$.callback(MODS.project.status(MODS.project.load(opened.project.path), busy(opened.session)));
	}
});
