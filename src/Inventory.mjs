import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Fail } from './Config.mjs';

export const REQUIRED_DIR_EXCLUSIONS = ['.git', '.recipe-state', '.microgulp', 'node_modules', '.ssh', '.aws'];
export const REQUIRED_FILE_EXCLUSIONS = ['.env', '.npmrc', '.netrc', 'nas-backup.local.json'];

export function PathsOverlap(_left, _right) {
	let normalize = (_value) => process.platform === 'win32' ? path.resolve(_value).toLowerCase() : path.resolve(_value);
	let left = normalize(_left), right = normalize(_right);
	let contains = (_parent, _child) => {
		let relative = path.relative(_parent, _child);
		return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
	};
	return contains(left, right) || contains(right, left);
}

/** Reject symlink/junction components, including an existing target's parents. */
export async function SafeDirectory(_directory) {
	let absolute = path.resolve(_directory);
	let current = path.parse(absolute).root;
	for (let segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		let stat = await fs.lstat(current);
		if (stat.isSymbolicLink() || !stat.isDirectory()) Fail('UNSAFE_DIRECTORY', current);
	}
	return fs.realpath(absolute);
}

export async function HashFile(_file) {
	let hash = createHash('sha256');
	for await (let chunk of createReadStream(_file)) hash.update(chunk);
	return hash.digest('hex');
}

/** One inventory defines identical inclusion semantics for all engines. */
export async function Inventory(_source, _exclusions) {
	let files = [], skipped = [];
	let directories = new Set([...REQUIRED_DIR_EXCLUSIONS, ..._exclusions.directoryNames].map((_v) => _v.toLowerCase()));
	let names = new Set([...REQUIRED_FILE_EXCLUSIONS, ..._exclusions.fileNames].map((_v) => _v.toLowerCase()));
	let relativePaths = _exclusions.relativePaths.map((_v) => _v.toLowerCase());
	async function Walk(_directory, _prefix = '') {
		for (let entry of await fs.readdir(_directory, { withFileTypes: true })) {
			let relative = _prefix + entry.name, lower = relative.toLowerCase(), name = entry.name.toLowerCase();
			let excluded = relativePaths.some((_v) => lower === _v || lower.startsWith(_v + '/')) ||
				(entry.isDirectory() && directories.has(name)) || names.has(name) || name.startsWith('.env.') || /\.(pem|key|p12|pfx)$/i.test(name);
			if (excluded) { skipped.push({ path: relative, reason: 'excluded' }); continue; }
			let absolute = path.join(_directory, entry.name);
			let stat = await fs.lstat(absolute);
			if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) Fail('UNSUPPORTED_FILE_TYPE', relative);
			if (stat.isDirectory()) await Walk(absolute, relative + '/');
			else {
				if (stat.nlink > 1) Fail('HARDLINK_NOT_SUPPORTED', relative);
				let sha256 = await HashFile(absolute), after = await fs.stat(absolute);
				if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) Fail('SOURCE_CHANGED', relative);
				files.push({ path: relative, size: stat.size, sha256 });
			}
		}
	}
	await Walk(_source);
	files.sort((_a, _b) => _a.path < _b.path ? -1 : _a.path > _b.path ? 1 : 0);
	return { files, skipped };
}

export async function VerifyFiles(_root, _files) {
	for (let file of _files) {
		let absolute = path.join(_root, file.path);
		await SafeDirectory(path.dirname(absolute));
		let stat = await fs.lstat(absolute);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size !== file.size || await HashFile(absolute) !== file.sha256) Fail('VERIFY_FAILED', file.path);
	}
}
