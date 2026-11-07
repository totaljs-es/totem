'use strict';

// Makes every provider icon the same: a viewBox of 24 by 24, the drawing scaled to fit in a box of 20 by 20 and centered, one colour
// (currentColor, so the interface paints it with the colour of the text), no fixed size and no style. It works in place on
// public/img/providers/: a new icon is dropped there as it was received and this script makes it like the others (running it again changes nothing).
// This is a tooling script that runs with plain Node.js: it is not part of the Total.js application.
//
//   node scripts/normalize-icons.js           normalizes public/img/providers/*.svg
//   node scripts/normalize-icons.js --check   exits with 1 when a file of public/img/providers/ differs from what it would write

var Fs = require('fs');
var Path = require('path');

var ROOT = Path.join(__dirname, '..');
var TARGET = Path.join(ROOT, 'public/img/providers');
var BOX = 20;
var SIZE = 24;

var ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
var NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

// The bounding box of the path data: the extremes of the lines and a sampling of the curves and the arcs
function bounds(d) {

	var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	var x = 0, y = 0, sx = 0, sy = 0;
	var lastc = null;
	var lastcmd = '';
	var i = 0;
	var cmd = '';

	function add(px, py) {
		box.x0 = Math.min(box.x0, px);
		box.y0 = Math.min(box.y0, py);
		box.x1 = Math.max(box.x1, px);
		box.y1 = Math.max(box.y1, py);
	}

	function skip() {
		while (i < d.length && /[\s,]/.test(d[i]))
			i++;
	}

	function number() {
		skip();
		var match = d.substring(i).match(NUMBER);
		if (!match)
			throw new Error('Bad path data near: ' + d.substring(i, i + 20));
		i += match[0].length;
		return parseFloat(match[0]);
	}

	// An arc flag is one character, and the next number can follow it with no separator
	function flag() {
		skip();
		var c = d[i++];
		if (c !== '0' && c !== '1')
			throw new Error('Bad arc flag near: ' + d.substring(i - 1, i + 20));
		return c === '1' ? 1 : 0;
	}

	function cubic(x0, y0, x1, y1, x2, y2, x3, y3) {
		for (var t = 0; t <= 1.0001; t += 1 / 40) {
			var u = 1 - t;
			add(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
		}
	}

	function quad(x0, y0, x1, y1, x2, y2) {
		for (var t = 0; t <= 1.0001; t += 1 / 40) {
			var u = 1 - t;
			add(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
		}
	}

	// An arc from the endpoint form to the center form (the SVG specification, F.6.5), sampled
	function arc(x0, y0, rx, ry, rot, large, sweep, x1, y1) {

		if (!rx || !ry) {
			add(x1, y1);
			return;
		}

		rx = Math.abs(rx);
		ry = Math.abs(ry);

		var phi = rot * Math.PI / 180;
		var cos = Math.cos(phi);
		var sin = Math.sin(phi);
		var dx = (x0 - x1) / 2;
		var dy = (y0 - y1) / 2;
		var xp = cos * dx + sin * dy;
		var yp = -sin * dx + cos * dy;
		var lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);

		if (lambda > 1) {
			rx *= Math.sqrt(lambda);
			ry *= Math.sqrt(lambda);
		}

		var numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
		var denominator = rx * rx * yp * yp + ry * ry * xp * xp;
		var factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
		var cxp = factor * (rx * yp / ry);
		var cyp = factor * (-ry * xp / rx);
		var cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
		var cy = sin * cxp + cos * cyp + (y0 + y1) / 2;

		var angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
		var theta = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
		var delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);

		if (!sweep && delta > 0)
			delta -= 2 * Math.PI;
		else if (sweep && delta < 0)
			delta += 2 * Math.PI;

		for (var k = 0; k <= 64; k++) {
			var a = theta + delta * k / 64;
			add(cos * rx * Math.cos(a) - sin * ry * Math.sin(a) + cx, sin * rx * Math.cos(a) + cos * ry * Math.sin(a) + cy);
		}
	}

	skip();

	while (i < d.length) {

		var c = d[i];

		if (/[A-Za-z]/.test(c)) {
			cmd = c;
			i++;
		} else if (!cmd)
			throw new Error('The path data does not start with a command');
		else if (cmd === 'M')
			cmd = 'L';
		else if (cmd === 'm')
			cmd = 'l';

		var up = cmd.toUpperCase();
		var rel = cmd !== up;

		if (up === 'Z') {
			x = sx;
			y = sy;
			lastc = null;
			lastcmd = 'Z';
			skip();
			continue;
		}

		var a = [];
		for (var n = 0; n < ARITY[up]; n++)
			a.push(up === 'A' && (n === 3 || n === 4) ? flag() : number());

		var ox = rel ? x : 0;
		var oy = rel ? y : 0;

		switch (up) {
			case 'M':
				x = ox + a[0]; y = oy + a[1]; sx = x; sy = y; add(x, y);
				lastc = null;
				break;
			case 'L':
				x = ox + a[0]; y = oy + a[1]; add(x, y);
				lastc = null;
				break;
			case 'H':
				x = (rel ? x : 0) + a[0]; add(x, y);
				lastc = null;
				break;
			case 'V':
				y = (rel ? y : 0) + a[0]; add(x, y);
				lastc = null;
				break;
			case 'C':
				cubic(x, y, ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]);
				lastc = [ox + a[2], oy + a[3]];
				x = ox + a[4]; y = oy + a[5];
				break;
			case 'S':
				var r1 = lastc && /[CS]/i.test(lastcmd) ? [2 * x - lastc[0], 2 * y - lastc[1]] : [x, y];
				cubic(x, y, r1[0], r1[1], ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
				lastc = [ox + a[0], oy + a[1]];
				x = ox + a[2]; y = oy + a[3];
				break;
			case 'Q':
				quad(x, y, ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
				lastc = [ox + a[0], oy + a[1]];
				x = ox + a[2]; y = oy + a[3];
				break;
			case 'T':
				var r2 = lastc && /[QT]/i.test(lastcmd) ? [2 * x - lastc[0], 2 * y - lastc[1]] : [x, y];
				quad(x, y, r2[0], r2[1], ox + a[0], oy + a[1]);
				lastc = r2;
				x = ox + a[0]; y = oy + a[1];
				break;
			case 'A':
				arc(x, y, a[0], a[1], a[2], a[3], a[4], ox + a[5], oy + a[6]);
				x = ox + a[5]; y = oy + a[6];
				lastc = null;
				break;
		}

		lastcmd = up;
		skip();
	}

	return box;
}

exports.bounds = bounds;

function round(value, digits) {
	return parseFloat(value.toFixed(digits));
}

// The normalized svg of a source: { svg, box }
exports.normalize = function(text, title) {

	var root = text.match(/<svg[^>]*>/)[0];
	var paths = (text.match(/<path\b[^>]*>/g) || []).map(tag => ({ d: (tag.match(/\sd="([^"]+)"/) || [])[1], rule: (tag.match(/\sfill-rule="([^"]+)"/) || [])[1], clip: (tag.match(/\sclip-rule="([^"]+)"/) || [])[1] })).filter(p => p.d);

	if (!paths.length)
		throw new Error('The icon has no path');

	var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

	paths.forEach(function(p) {
		var b = bounds(p.d);
		box.x0 = Math.min(box.x0, b.x0);
		box.y0 = Math.min(box.y0, b.y0);
		box.x1 = Math.max(box.x1, b.x1);
		box.y1 = Math.max(box.y1, b.y1);
	});

	var width = box.x1 - box.x0;
	var height = box.y1 - box.y0;
	var scale = BOX / Math.max(width, height);
	var tx = SIZE / 2 - (box.x0 + width / 2) * scale;
	var ty = SIZE / 2 - (box.y0 + height / 2) * scale;

	// The rules that decide the holes of a shape are kept: on the root when they are there, on the path when it has its own
	var rootrule = (root.match(/\sfill-rule="([^"]+)"/) || [])[1];
	var rootclip = (root.match(/\sclip-rule="([^"]+)"/) || [])[1];

	var attrs = ' xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" fill="currentColor"';

	if (rootrule)
		attrs += ' fill-rule="' + rootrule + '"';

	if (rootclip)
		attrs += ' clip-rule="' + rootclip + '"';

	var body = paths.map(p => '<path d="' + p.d + '"' + (p.rule ? ' fill-rule="' + p.rule + '"' : '') + (p.clip ? ' clip-rule="' + p.clip + '"' : '') + '/>').join('');

	return {
		svg: '<svg' + attrs + '><title>' + title.replace(/[<&>]/g, '') + '</title><g transform="translate(' + round(tx, 3) + ' ' + round(ty, 3) + ') scale(' + round(scale, 5) + ')">' + body + '</g></svg>\n',
		box: { x: round(box.x0, 2), y: round(box.y0, 2), width: round(width, 2), height: round(height, 2) }
	};
};

if (require.main === module) {

	var names = {};

	JSON.parse(Fs.readFileSync(Path.join(ROOT, 'private/providers.json'), 'utf8')).forEach(t => t.icon && (names[t.icon] = t.name));

	var check = process.argv.indexOf('--check') !== -1;
	var different = [];

	Fs.readdirSync(TARGET).filter(file => /\.svg$/.test(file)).sort().forEach(function(file) {

		var id = file.replace(/\.svg$/, '');
		var result = exports.normalize(Fs.readFileSync(Path.join(TARGET, file), 'utf8'), names[id] || id);
		var target = Path.join(TARGET, file);

		if (check) {
			if (!Fs.existsSync(target) || Fs.readFileSync(target, 'utf8') !== result.svg)
				different.push(file);
		} else {
			Fs.writeFileSync(target, result.svg);
			console.log(file.padEnd(18) + 'drawing ' + result.box.width + ' x ' + result.box.height);
		}
	});

	if (check) {
		if (different.length)
			console.error('These icons are not normalized: ' + different.join(', ') + '. Run node scripts/normalize-icons.js');
		process.exit(different.length ? 1 : 0);
	}
}
