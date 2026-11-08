// The conventions of Total.js 5 as a check of what the tools write. The check is a copy of tools/check.js of the conventions
// repository (private/conventions/SOURCE.md). It only looks at files of a Total.js 5 project, so any other project is left alone.

exports.id = 'conventions';

var checker = null;

function load() {
	if (!checker)
		checker = REQUIRE(PATH.private('conventions/check.js'));
	return checker;
}

// Raw HTML is code, never Markdown markup. Preserve the source exactly and fence the complete document.
exports.prepare = function(text, review) {
	text = (text || '').trim();
	if (review && /^(?:Totem checked the code of your answer|Return only the final solution)/i.test(text)) {
		var fence = text.indexOf('```');
		if (fence !== -1)
			text = text.substring(fence);
	}
	if (!/```/.test(text)) {
		var start = text.search(/<!doctype html\b|<html\b/i);
		var end = text.toLowerCase().lastIndexOf('</html>');
		if (start !== -1 && end > start)
			text = text.substring(0, start).trim() + '\n\n```html\n' + text.substring(start, end + 7) + '\n```' + text.substring(end + 7);
	}
	// Whitespace-only indentation fixes do not need another model request. Avoid literal content where whitespace is data.
	text = text.replace(/```(js|javascript|html)([^\n]*)\n([\s\S]*?)```/gi, function(all, lang, info, code) {
		if (/`|\\\r?\n|<(?:pre|textarea)\b/i.test(code))
			return all;
		var lines = code.split('\n');
		var width = 0;
		lines.forEach(function(line) {
			var match = line.match(/^ +(?! )\S/);
			var size = match ? match[0].length - 1 : 0;
			if (size >= 2)
				width = width ? Math.min(width, size) : size;
		});
		if (!width)
			return all;
		return '```' + lang + info + '\n' + lines.map(function(line) {
			return line.replace(/^ +/, function(spaces) {
				return '\t'.repeat(Math.floor(spaces.length / width)) + ' '.repeat(spaces.length % width);
			});
		}).join('\n') + '```';
	});
	return text.trim();
};

// The findings about a file that a tool has just written, as text for the model; an empty text when there is nothing to say
exports.review = function(path, content, conf) {

	if ((conf || CONF).conventions === false)
		return '';

	try {
		var result = load().hook({ tool_name: 'Write', tool_input: { file_path: path, content: content } });
		return result.message ? ('\n\n' + result.message) : '';
	} catch (e) {
		return '';
	}
};

// The code that the model shows in an answer, checked like the files that the tools write: [{ block, line, rule, severity, message }].
// Syntax, the rules of the conventions (tabs, ES5, names with |, texts with @()...) and the functions in capital letters that Total.js 5 does not have.
// A sketch with a line of "..." is not code to check. Only js and html blocks count.
var VM = null;

function syntaxof(code) {

	try {
		VM = VM || REQUIRE('node:vm');
		new VM.Script('(async function(){' + code + '\n})', { filename: 'answer' });
		return '';
	} catch (e) {
		// Only unquoted template tokens need rendering; markers inside strings or comments do not excuse broken JavaScript.
		var plain = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
		if (/@\{/.test(plain) || /\breturn\s+@\(/.test(plain))
			return '';
		return e.message;
	}
}

var SERVERCODE = /\b(NEWACTION|NEWSCHEMA|ROUTE|NOSQL|DATA|CRON|AUTH|FUNC|MAIN|MODS|RESTBuilder|UID|CONF)\b|exports\.install/;
var INTERFACE = /\b(COMPONENT|PLUGIN|COMPONENTATOR|SETTER)\(/;

exports.answer = function(text, conf) {

	if ((conf || CONF).conventions === false || !text)
		return [];

	var found = [];
	var known = null;
	var regex = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
	var match;
	var number = 0;

	while ((match = regex.exec(text))) {

		var lang = match[1].toLowerCase();
		if (!lang && /^\s*(?:<!--[^]*?-->\s*)?(?:<!doctype|<html|<ui-component|<script)/i.test(match[2]))
			lang = 'html';
		var js = lang === 'js' || lang === 'javascript';

		if (!js && lang !== 'html')
			continue;

		number++;
		var code = match[2].replace(/\s+$/, '') + '\n';

		if (/^\s*(\.\.\.|…|\/\/\s*\.\.\.)\s*$/m.test(code))
			continue;

		var add = function(line, rule, severity, message) {
			found.push({ block: number, line: line, rule: rule, severity: severity, message: message });
		};

		try {
			load().text(code, { file: 'answer', type: js ? 'js' : 'html' }).forEach(f => add(f.line, f.rule, f.severity, f.message));
		} catch (e) {}

		if (/\bself\.find\([^\n]*?\)\.(?:style|textContent|innerHTML)\b/.test(code))
			add(1, 'jcomponent-dom', 'error', 'self.find() returns a jQuery collection. Use .text(), .html(), .css() or .toggle(), not DOM properties on the collection.');

		if (/new\s+TOTAL\.Component\s*\(/.test(code))
			add(1, 'jcomponent-api', 'error', 'TOTAL.Component is not the jComponent 20 API. Declare COMPONENT(name, config, function(self, config)) and mount it with <ui-component name="name" path="app.value">.');

		if (!js) {
			var scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
			var script;
			while ((script = scripts.exec(code))) {
				if (/\bsrc\s*=|\btype\s*=\s*["'](?:text\/html|application\/(?:ld\+)?json)["']/i.test(script[1]))
					continue;
				var scripterror = syntaxof(script[2]);
				scripterror && add(1, 'syntax', 'error', scripterror);
			}
		}

		if (js) {

			var error = syntaxof(code);
			error && add(1, 'syntax', 'error', error);

			// A function of capital letters that Total.js 5 does not have (an invented one)
			if (SERVERCODE.test(code) && !INTERFACE.test(code)) {
				known = known || Object.keys(global).filter(key => /^[A-Z][A-Za-z0-9_]*$/.test(key));
				var declared = {};
				(code.match(/\b(?:function|var|let|const)\s+([A-Z][A-Z0-9_]+)\b/g) || []).forEach(d => declared[d.split(/\s+/)[1]] = true);
				var seen = {};
				(code.match(/(^|[^.\w$])[A-Z][A-Z0-9_]{2,}\(/gm) || []).forEach(function(call) {
					var name = call.replace(/^[^A-Z]*/, '').replace('(', '');
					if (!seen[name] && known.indexOf(name) === -1 && !declared[name]) {
						seen[name] = true;
						add(1, 'unknown-function', 'error', name + '() does not exist in Total.js 5: do not invent functions, use the recipes and pages above or say that you do not know');
					}
				});
			}
		}
	}

	return found;
};

// The message that asks the model to correct its answer (a request of its own, not stored: only this run has it)
exports.complaint = function(findings) {
	return 'Totem checked the code of your answer against the conventions of Total.js 5 and found this:\n' +
		findings.slice(0, 8).map(f => '- code block {0}, line {1}: {2} ({3}) {4}'.format(f.block, f.line, f.rule, f.severity, f.message)).join('\n') +
		(findings.length > 8 ? '\n- and {0} more'.format(findings.length - 8) : '') +
		'\n\nReturn only the final solution with complete corrected code in fenced Markdown blocks labelled js or html. Do not quote this review, the earlier draft or these instructions. Indent with TABS. Use only functions that exist in Total.js 5. Do not add anything else.';
};
