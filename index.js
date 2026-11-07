// ===================================================
// Total.js Totem
// https://github.com/totaljs-es/totem
// ===================================================

require('total5');

const options = {};

// Total.js runs without the watcher (release mode) when `watcher` is false
options.watcher = !process.argv.includes('--release');
options.servicemode = process.argv.includes('--service') || process.argv.includes('--servicemode');

// A folder for the data (databases, tmp and logs): `totem` gives one when the application is installed from npm, where the folder of the
// application is not the place for what changes. Without it everything stays in the folder of the application, as in a clone.
var data = process.argv.indexOf('--data');

if (data !== -1 && process.argv[data + 1]) {
	var folder = require('node:path').resolve(process.argv[data + 1]);
	options.config = { $dirdatabases: folder + '/databases', $dirtmp: folder + '/tmp', $dirlogs: folder + '/logs' };
}

F.run(options);
