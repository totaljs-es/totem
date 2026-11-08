#!/usr/bin/env node
'use strict';

// Measures how well Totem chooses the page of Forge for a request, without any model: for every prompt of tests/knowledge/docs-cases.json the
// ranking of modules/knowledge.js (the index llms.txt of Forge, joined to the API names and tags of knowledge.json) must put one of the expected pages
// first (top-1) or among the first three (top-3). A tooling script that runs with plain Node.js: it is not part of the application.
//
//   node scripts/docs-eval.js                          against https://forge.totaljs.es
//   node scripts/docs-eval.js --url <forge> --cases <file> --show      --show prints every case
//
// "before" ranks by title, address and description only; "after" also uses the metadata, as Totem does.

var Path = require('path');
var Fs = require('fs');

global.CONF = {};
global.MAIN = {};
global.PATH = { private: () => '/nonexistent' };

var knowledge = require(Path.join(__dirname, '../modules/knowledge.js'));
var args = process.argv.slice(2);

function option(name, fallback) {
	var index = args.indexOf('--' + name);
	return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

var url = option('url', 'https://forge.totaljs.es').replace(/\/+$/, '');
var cases = JSON.parse(Fs.readFileSync(option('cases', Path.join(__dirname, '../tests/knowledge/docs-cases.json')), 'utf8'));
var show = args.indexOf('--show') !== -1;

async function text(address) {
	var response = await fetch(address);
	if (!response.ok)
		throw new Error(address + ' answered ' + response.status);
	return response.text();
}

function slug(item) {
	var match = item.url.match(/\/([^\/]+)\.md$/);
	return match && match[1];
}

function measure(items, label) {

	var first = 0;
	var three = 0;
	var misses = [];

	cases.forEach(function(item) {
		var found = knowledge.rank(items, knowledge.route(item.prompt), 3).map(slug);
		var hit1 = item.expect.indexOf(found[0]) !== -1;
		var hit3 = found.some(name => item.expect.indexOf(name) !== -1);
		hit1 && first++;
		hit3 && three++;
		if (show || !hit3)
			misses.push((hit1 ? 'top-1' : (hit3 ? 'top-3' : 'MISS ')) + '  ' + item.prompt + '  =>  ' + found.join(', ') + '  (expected ' + item.expect.join(' | ') + ')');
	});

	console.log('{0}: top-1 {1}/{2}, top-3 {3}/{2}'.replace('{0}', label).replace(/\{1\}/, first).replace(/\{2\}/g, cases.length).replace('{3}', three));
	return misses;
}

(async function() {

	var index = await text(url + '/llms.txt');
	var plain = knowledge.parseindex(index);
	var joined = knowledge.parseindex(index);

	knowledge.addmeta(joined, await text(url + '/knowledge.json'));

	measure(plain, 'before');
	var misses = measure(joined, 'after ');
	misses.length && console.log('\n' + misses.join('\n'));

})().catch(function(err) {
	console.error(err.message);
	process.exit(1);
});
