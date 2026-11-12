exports.icon = 'ti ti-check-circle';
exports.name = '@(Tasks)';
exports.position = 1;
exports.visible = function() {
	return true;
};

exports.install = function() {
	ROUTE('+API    ?    -tasks                   --> Tasks|list');
	ROUTE('+API    ?    -tasks_read/{id}         --> Tasks|read');
	ROUTE('+API    ?    +tasks_save              --> Tasks|save');
	ROUTE('+API    ?    -tasks_remove/{id}       --> Tasks|remove');
};
