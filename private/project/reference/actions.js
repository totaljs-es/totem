NEWACTION('Tasks|list', {
	name: 'List of tasks',
	action: async function($) {
		var items = await DATA.find('nosql/tbl_task').sort('dtcreated_desc').promise($);
		$.callback(items);
	}
});

NEWACTION('Tasks|read', {
	name: 'Read a task',
	params: '*id:UID',
	action: async function($) {
		var item = await DATA.read('nosql/tbl_task').id($.params.id).error(404).promise($);
		$.callback(item);
	}
});

NEWACTION('Tasks|save', {
	name: 'Create or update a task',
	input: 'id:UID, *name:String, note:String',
	action: async function($, model) {

		if (model.id) {
			model.dtupdated = NOW;
			await DATA.modify('nosql/tbl_task', model).id(model.id).error(404).promise($);
		} else {
			model.id = UID();
			model.dtcreated = NOW;
			await DATA.insert('nosql/tbl_task', model).promise($);
		}

		$.success(model.id);
	}
});

NEWACTION('Tasks|remove', {
	name: 'Remove a task',
	params: '*id:UID',
	action: async function($) {
		await DATA.remove('nosql/tbl_task').id($.params.id).error(404).promise($);
		$.success($.params.id);
	}
});
