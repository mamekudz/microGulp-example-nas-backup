import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { DisplayName } from '../src/DisplayName.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let code = '', files = 0;
function Walk(_directory) {
	for (let entry of fs.readdirSync(_directory, { withFileTypes: true })) {
		if (['node_modules', '.recipe-state', '.microgulp', '.git'].includes(entry.name)) continue;
		let file = path.join(_directory, entry.name);
		if (entry.isDirectory()) Walk(file);
		else if (file.endsWith('.mjs')) {
			execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
			let content = fs.readFileSync(file, 'utf8');
			assert(!/[\u2010-\u2015\u2212\ufe63\uff0d]/.test(content), 'Non-ASCII dash: ' + file);
			if (!file.includes(path.sep + 'tests' + path.sep) && !file.includes(path.sep + 'tools' + path.sep)) code += content;
			files++;
		}
	}
}
Walk(ROOT);
let dictionaries = ['en-US', 'de-DE'].map((_lid) => JSON.parse(fs.readFileSync(path.join(ROOT, 'i18x/gulp', _lid + '.json'), 'utf8')));
let phrases = [...code.matchAll(/'([^'\n]*<context="[^"]+"\/>[^'\n]*)'/g)].map((_match) => _match[1]);
phrases = phrases.filter((_phrase) => !/^<context="[^"]+"\/>$/.test(_phrase));
for (let mask = 0; mask < 16; mask++) {
	let displayName = Object.fromEntries(['version', 'commit', 'changes', 'lastBackup'].map((_key, _index) => [_key, !!(mask & (1 << _index))]));
	phrases.push(DisplayName({ features: { dynamicDisplayName: true }, displayName }, true));
}
for (let phrase of phrases) {
	for (let dictionary of dictionaries) {
		assert(Object.hasOwn(dictionary, phrase), 'Missing translation: ' + phrase);
		let placeholders = (_value) => [..._value.matchAll(/<([a-zA-Z]+)\/>/g)].map((_match) => _match[1]).sort();
		assert.deepEqual(placeholders(dictionary[phrase]), placeholders(phrase), 'Placeholder mismatch: ' + phrase);
	}
}
console.log(JSON.stringify({ syntaxFiles: files, checkedPhrases: new Set(phrases).size, locales: ['en-US', 'de-DE'], ok: true }));
