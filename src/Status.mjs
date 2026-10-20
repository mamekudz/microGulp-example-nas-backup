import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function _Git(_source, _args) {
	return execFileSync('git', ['--no-optional-locks', '-C', _source, ..._args], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Local metadata only: never query NAS from a display-name factory. */
export function ReadStatus(_config) {
	let status = { version: null, git: 'disabled', commit: null, dirty: null, warnings: [] };
	try {
		let file = path.join(_config.source, 'RELEASES.json');
		if (fs.existsSync(file)) {
			let release = JSON.parse(fs.readFileSync(file, 'utf8')).releases?.[0];
			if (!release || !['main', 'minor', 'revision'].every((_key) => Number.isInteger(release[_key]) && release[_key] >= 0)) throw new Error('invalid release');
			status.version = `${release.main}.${release.minor}.${release.revision}${release.beta ? 'ß' : ''}`;
		}
	} catch { status.warnings.push('RELEASE_VERSION_UNAVAILABLE'); }
	if (!status.version) {
		try { status.version = JSON.parse(fs.readFileSync(path.join(_config.source, 'package.json'), 'utf8')).version ?? null; }
		catch { /* Version metadata is optional. */ }
	}
	if (_config.features.git) {
		try {
			if (_Git(_config.source, ['rev-parse', '--is-inside-work-tree']) !== 'true') throw new Error('not worktree');
			status.git = 'repository';
			status.dirty = _Git(_config.source, ['status', '--porcelain', '--untracked-files=normal']).length > 0;
			try { status.commit = _Git(_config.source, ['rev-parse', '--short=12', 'HEAD']); }
			catch { status.git = 'unborn'; }
			if (!status.version && status.commit) {
				try { status.version = _Git(_config.source, ['describe', '--tags', '--always']); } catch { /* Optional. */ }
			}
		} catch (_error) {
			let message = String(_error.stderr ?? '');
			status.git = /not a git repository/i.test(message) ? 'none' : 'unavailable';
			if (status.git === 'unavailable') status.warnings.push('GIT_UNAVAILABLE');
		}
	}
	return status;
}

export function ReadHistory(_source, _targets) {
	let history = Object.fromEntries(_targets.map((_target) => [_target.id, { lastSuccess: null, lastResult: null, records: 0 }]));
	let root = path.join(_source, '.recipe-state', 'history');
	try {
		for (let name of fs.readdirSync(root)) {
			if (!name.endsWith('.json')) continue;
			let record;
			try { record = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
			catch { continue; }
			let target = _targets.find((_target) => _target.id === record.targetId && path.resolve(_target.path) === record.destination);
			if (!target || !['success', 'failed'].includes(record.status)) continue;
			let item = history[target.id];
			item.records++;
			if (!item.lastResult || record.finishedAt > item.lastResult.finishedAt) item.lastResult = record;
			if (record.status === 'success' && (!item.lastSuccess || record.finishedAt > item.lastSuccess)) item.lastSuccess = record.finishedAt;
		}
	} catch { /* Missing local history is not proof of a missing NAS snapshot. */ }
	return history;
}
