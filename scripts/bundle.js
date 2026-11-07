#!/usr/bin/env node
'use strict';

// Generates the bundle of jComponent components (public/ui-ui-*.min.js) that the published package ships. The application downloads it at the first start when it
// is missing and writes it in public/, which is not possible when the package is installed where the person cannot write, and needs a connection. With the bundle in the package
// the application only checks that it is there. A tooling script that runs with plain Node.js: it is not part of the application.
//
//   node scripts/bundle.js

var Child = require('child_process');
var Fs = require('fs');
var Net = require('net');
var Os = require('os');
var Path = require('path');

var ROOT = Path.join(__dirname, '..');
var PUBLIC = Path.join(ROOT, 'public');

function bundles() {
	return Fs.readdirSync(PUBLIC).filter(name => /^ui-ui-.*\.min\.js$/.test(name));
}

function freeport() {
	return new Promise(function(resolve) {
		var server = Net.createServer();
		server.listen(0, '127.0.0.1', function() {
			var port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

async function main() {

	if (bundles().length) {
		console.log('The bundle is there: ' + bundles().join(', '));
		return 0;
	}

	// A temporary data folder: the server that makes the bundle does not touch the databases of anybody
	var data = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totem-bundle-'));
	['databases', 'tmp', 'logs'].forEach(name => Fs.mkdirSync(Path.join(data, name)));

	var port = await freeport();
	var child = Child.spawn(process.execPath, [Path.join(ROOT, 'index.js'), String(port), '--release', '--data', data], { cwd: ROOT, stdio: 'ignore', detached: true });
	var found = [];

	for (var i = 0; i < 120 && !found.length; i++) {
		await new Promise(resolve => setTimeout(resolve, 500));
		found = bundles();
	}

	try {
		process.kill(-child.pid);
	} catch (e) {}

	Fs.rmSync(data, { recursive: true, force: true });

	if (!found.length) {
		console.error('The bundle was not generated: the server could not download the components (is there a connection?).');
		return 1;
	}

	console.log('Generated ' + found.join(', '));
	return 0;
}

main().then(code => process.exit(code));
