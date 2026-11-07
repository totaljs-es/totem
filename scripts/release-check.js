'use strict';

// What has to be true before a release is published. The workflow .github/workflows/release.yml runs it with the tag of the release, and it can be run by hand:
//
//   node scripts/release-check.js v0.1.0
//
// Without a tag it checks what it can (npm publish runs it that way). It prints the problems that it finds and exits with 1, or exits with 0.
// A tooling script that runs with plain Node.js: it is not part of the application.

const Fs = require('fs');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');

// The problems with publishing `tag` (for example "v0.1.0") from the folder `root`
exports.problems = function(tag, root) {

	root = root || ROOT;

	const read = file => Fs.readFileSync(Path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
	const pkg = JSON.parse(read('package.json'));
	const found = [];

	if (pkg.private)
		found.push('package.json says "private": true, which npm refuses to publish.');

	if (tag && tag !== 'v' + pkg.version)
		found.push('The tag is ' + tag + ' and package.json is version ' + pkg.version + '. The tag has to be v' + pkg.version + '.');

	const config = /^version\s*:\s*(\S+)/m.exec(read('config'));

	if (!config || config[1] !== pkg.version)
		found.push('The file config is version ' + (config && config[1]) + ', and package.json ' + pkg.version + '.');

	if (!new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '$', 'm').test(read('CHANGELOG.md')))
		found.push('CHANGELOG.md has no heading "## ' + pkg.version + '".');

	// What was installed when it was tested is what a person gets: an exact version, not a tag or a range
	const total5 = pkg.dependencies && pkg.dependencies.total5;

	if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(total5 || ''))
		found.push('The dependency total5 is "' + total5 + '": use the exact version that was tested.');

	// The README tells how to install it; while it says that nothing is published, the release is not ready
	if (/Nothing is published/.test(read('README.md')))
		found.push('README.md still says "Nothing is published". Write how to install it from npm and from the container registry, and change the Status.');

	if (!pkg.files || pkg.files.some(name => /^(databases|tests|docs|legacy|tmp|logs)(\/|$)/.test(name)))
		found.push('The files of the package have to be listed, and they are not data, tests or documentation.');

	return found;
};

if (require.main === module) {

	const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
	const found = exports.problems(/^v\d/.test(tag) ? tag : '');

	if (found.length) {
		for (const problem of found)
			console.error('- ' + problem);
		process.exit(1);
	}

	const pkg = require('../package.json');
	console.log('Ready to publish ' + pkg.name + ' ' + pkg.version + (tag ? ' (' + tag + ')' : ''));
}
