exports.install = function() {

	// Account and application
	ROUTE('+API    ?    -account                    --> Account|read');

	// Projects
	ROUTE('+API    ?    -projects                   --> Projects|list');
	ROUTE('+API    ?    +projects_open              --> Projects|open');
	ROUTE('+API    ?    -projects_remove/{id}       --> Projects|remove');
	ROUTE('+API    ?    -projects_files/{id}        --> Projects|files');
	ROUTE('+API    ?    -projects_commands/{id}     --> Projects|commands');
	ROUTE('+API    ?    -projects_git/{id}          --> Projects|git');

	// Folders of this computer
	ROUTE('+API    ?    -folders                    --> Folders|list');

	// Sessions
	ROUTE('+API    ?    -sessions                   --> Sessions|list');
	ROUTE('+API    ?    +sessions_create            --> Sessions|create');
	ROUTE('+API    ?    -sessions_read/{id}         --> Sessions|read');
	ROUTE('+API    ?    +sessions_update/{id}       --> Sessions|update');
	ROUTE('+API    ?    -sessions_remove/{id}       --> Sessions|remove');
	ROUTE('+API    ?    -sessions_messages/{id}     --> Sessions|messages');
	ROUTE('+API    ?    +sessions_prompt/{id}       --> Sessions|prompt', 1024 * 1024 * 20);
	ROUTE('+API    ?    -sessions_abort/{id}        --> Sessions|abort');
	ROUTE('+API    ?    -sessions_diff/{id}         --> Sessions|diff');
	ROUTE('+API    ?    +sessions_undo/{id}         --> Sessions|undo');
	ROUTE('+API    ?    +sessions_saveblock/{id}    --> Sessions|saveblock');
	ROUTE('+API    ?    -sessions_jobs/{id}         --> Sessions|jobs');
	ROUTE('+API    ?    +sessions_jobstop/{id}      --> Sessions|jobstop');
	ROUTE('+API    ?    +sessions_terminal/{id}     --> Sessions|terminal');
	ROUTE('+API    ?    +sessions_terminalinput/{id} --> Sessions|terminalinput');
	ROUTE('+API    ?    +sessions_terminalresize/{id} --> Sessions|terminalresize');
	ROUTE('+API    ?    +sessions_terminalstop/{id} --> Sessions|terminalstop');
	ROUTE('+API    ?    -sessions_git/{id}          --> Sessions|git');
	ROUTE('+API    ?    +sessions_worktreemerge/{id} --> Sessions|worktreemerge');
	ROUTE('+API    ?    +sessions_worktreediscard/{id} --> Sessions|worktreediscard');
	ROUTE('+API    ?    +sessions_redo/{id}         --> Sessions|redo');
	ROUTE('+API    ?    +sessions_fork/{id}         --> Sessions|fork');
	ROUTE('+API    ?    -sessions_todos/{id}        --> Sessions|todos');

	// Permissions
	ROUTE('+API    ?    +permissions_reply/{id}     --> Permissions|reply');
	ROUTE('+API    ?    -permissions                --> Permissions|list');
	ROUTE('+API    ?    +questions_reply/{id}       --> Questions|reply');
	ROUTE('+API    ?    -permissions_remove/{id}    --> Permissions|remove');

	// Scheduled prompts
	ROUTE('+API    ?    -schedules                  --> Schedules|list');
	ROUTE('+API    ?    +schedules_save             --> Schedules|save');
	ROUTE('+API    ?    -schedules_remove/{id}      --> Schedules|remove');
	ROUTE('+API    ?    +schedules_run/{id}         --> Schedules|run');

	// Providers
	ROUTE('+API    ?    -settings/{scope}/{id}      --> Settings|read');
	ROUTE('+API    ?    +settings_save              --> Settings|save');
	ROUTE('+API    ?    -agents/{projectid}         --> Agents|list');
	ROUTE('+API    ?    +agents_save                --> Agents|save');
	ROUTE('+API    ?    +agents_remove              --> Agents|remove');
	ROUTE('+API    ?    -providers                  --> Providers|list');
	ROUTE('+API    ?    +providers_save             --> Providers|save');
	ROUTE('+API    ?    -providers_remove/{id}      --> Providers|remove');
	ROUTE('+API    ?    -providers_models           --> Providers|models');
	ROUTE('+API    ?    -providers_catalog          --> Providers|catalog');
	ROUTE('+API    ?    -providers_templates        --> Providers|templates');
	ROUTE('+API    ?    -providers_detect           --> Providers|detect');
	ROUTE('+API    ?    +providers_available        --> Providers|available');

	// Events
	ROUTE('+SOCKET ?', socket);
};

function socket($) {

	MAIN.ws = $;
	$.autodestroy(() => MAIN.ws = null);

	$.on('open', function(client) {

		// A page of another origin cannot listen to the events of the sessions
		if (!FUNC.sameorigin(client.headers)) {
			client.destroy();
			return;
		}

		client.sessions = {};
	});

	$.on('message', function(client, msg) {
		if (msg.type === 'subscribe' && msg.sessionid) {
			client.sessions[msg.sessionid] = true;

			// What the session is waiting for, for a client that was not there when it was asked
			MODS.permissions.pending(msg.sessionid).forEach(event => client.send({ type: event.type, sessionid: msg.sessionid, ts: Date.now(), data: event.data }));
		}
		else if (msg.type === 'unsubscribe' && msg.sessionid)
			delete client.sessions[msg.sessionid];
	});
}
