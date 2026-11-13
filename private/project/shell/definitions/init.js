// The components of the interface, downloaded once as one file: the layout loads it with @{REPO.ui}
ON('ready', function() {
	COMPONENTATOR('ui', 'exec,errorhandler,locale,page,importer,miniform,input,validate,empty,selected,notify,approve,loading,datepicker', true);
});
