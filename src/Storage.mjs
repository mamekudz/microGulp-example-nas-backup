import fs from 'node:fs/promises';
import path from 'node:path';
import { SafeDirectory } from './Inventory.mjs';
import { Fail } from './Config.mjs';

export function BackupOptions(_config) {
	return { mode: 'fixed', format: 'directory', ..._config.backup };
}

export async function Exists(_path) {
	try { await fs.lstat(_path); return true; } catch (_error) { if (_error.code === 'ENOENT') return false; throw _error; }
}

// Before replacing/deleting a managed tree, reject links and non-regular entries.
export async function CheckTree(_root) {
	await SafeDirectory(_root);
	for (const entry of await fs.readdir(_root, { withFileTypes: true })) {
		const file = path.join(_root, entry.name), stat = await fs.lstat(file);
		if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) Fail('UNSAFE_BACKUP_TREE', file);
		if (stat.isDirectory()) await CheckTree(file);
	}
}

export async function CheckCurrent(_destination, _config, _target) {
	const current = path.join(_destination, 'current');
	if (!await Exists(current)) return false;
	await CheckTree(current);
	const manifest = JSON.parse(await fs.readFile(path.join(current, 'manifest.json'), 'utf8'));
	if (manifest.status !== 'success' || manifest.projectId !== _config.projectId || manifest.targetId !== _target.id || manifest.backup?.mode !== 'fixed') Fail('CURRENT_NOT_OWNED');
	return true;
}

/** Only the fixed, marked current tree is replaced. Historical snapshots stay untouched. */
export async function PublishFixed(_destination, _staging, _config, _target, _runId) {
	await SafeDirectory(_destination);
	if (path.dirname(_staging) !== _destination || path.basename(_staging) !== _config.projectId + '--' + _runId) Fail('STAGING_PATH');
	await CheckTree(_staging);
	const current = path.join(_destination, 'current');
	const previous = path.join(_destination, '.previous-' + _runId);
	const hasCurrent = await CheckCurrent(_destination, _config, _target);
	if (await Exists(previous)) Fail('PREVIOUS_EXISTS');
	if (hasCurrent) await fs.rename(current, previous);
	try { await fs.rename(_staging, current); }
	catch (_error) {
		if (hasCurrent) {
			try { await fs.rename(previous, current); }
			catch { throw Object.assign(new Error('RECOVERY_REQUIRED'), { code: 'RECOVERY_REQUIRED', previous }); }
		}
		throw _error;
	}
	let cleanupPending = null;
	if (hasCurrent) {
		try {
			// Both resolved endpoints are known children of the validated target.
			await SafeDirectory(_destination); await CheckTree(previous);
			await fs.rm(previous, { recursive: true });
		} catch { cleanupPending = previous; }
	}
	return { path: current, cleanupPending };
}
