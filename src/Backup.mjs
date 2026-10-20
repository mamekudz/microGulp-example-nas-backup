import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ValidateConfig, Fail } from './Config.mjs';
import { SafeDirectory, PathsOverlap, Inventory, VerifyFiles, REQUIRED_DIR_EXCLUSIONS, REQUIRED_FILE_EXCLUSIONS } from './Inventory.mjs';
import { SelectEngine, CopyFiles } from './Engines.mjs';
import { BackupOptions, CheckCurrent, PublishFixed } from './Storage.mjs';
import { WriteZip, VerifyZip } from './Zip.mjs';
import { GetVersionString } from '../tools/RecipeRelease.mjs';
import { ReadStatus } from './Status.mjs';

async function _WriteNewJson(_file, _value) {
	await fs.writeFile(_file, JSON.stringify(_value, null, 2) + '\n', { flag: 'wx' });
}

export async function ValidateTarget(_config, _target) {
	let destination = await SafeDirectory(_target.path);
	if (destination === path.parse(destination).root || PathsOverlap(_config.source, destination)) Fail('TARGET_OVERLAP', _target.id);
	let markerPath = path.join(destination, '.microgulp-target.json');
	let markerStat = await fs.lstat(markerPath);
	if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink > 1) Fail('TARGET_MARKER', _target.id);
	let marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
	if (marker.schemaVersion !== 1 || marker.projectId !== _config.projectId || marker.targetId !== _target.id) Fail('TARGET_MARKER', _target.id);
	return destination;
}

/** Dry runs do not write. Fixed output is replaced only after verification. */
export async function ExecuteBackup(_config, _selection, _options = {}) {
	ValidateConfig(_config);
	if (typeof _options.dryRun !== 'boolean') Fail('RUN_MODE_REQUIRED');
	let selected = new Set(_selection);
	if (!Array.isArray(_selection) || selected.size !== _selection.length || !selected.size || [...selected].some((_id) => !_config.targets.some((_target) => _target.id === _id))) Fail('TARGET_SELECTION');
	let config = { ..._config, source: await SafeDirectory(_config.source) };
	let targets = config.targets.filter((_target) => selected.has(_target.id));
	for (let index = 0; index < targets.length; index++) {
		if (PathsOverlap(config.source, targets[index].path)) Fail('TARGET_OVERLAP', targets[index].id);
		for (let other of targets.slice(index + 1)) if (PathsOverlap(targets[index].path, other.path)) Fail('TARGET_OVERLAP', targets[index].id);
	}
	let backup = BackupOptions(config);
	let engine = backup.format === 'zip' ? 'zip' : SelectEngine(config.engine);
	let inventory = await Inventory(config.source, config.exclusions);
	if (!inventory.files.length) Fail('EMPTY_INVENTORY');
	let status = ReadStatus(config);
	let runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
	let configDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
	let results = [], stateRoot = path.join(config.source, '.recipe-state'), lock;
	try {
		if (!_options.dryRun) {
			await fs.mkdir(stateRoot, { recursive: true });
			await SafeDirectory(stateRoot);
			lock = await fs.open(path.join(stateRoot, 'backup.lock'), 'wx');
			await lock.writeFile(JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString() }));
		}
		if (!_options.dryRun) {
			await fs.mkdir(path.join(stateRoot, 'history'), { recursive: true });
			await SafeDirectory(path.join(stateRoot, 'history'));
		}
		let physicalTargets = [];
		for (let target of targets) {
			let startedAt = new Date().toISOString(), snapshot = null, targetLock = null, targetLockPath = null;
			let result = { targetId: target.id, destination: path.resolve(target.path), status: 'failed' };
			try {
				let destination = await ValidateTarget(config, target);
				if (physicalTargets.some((_other) => PathsOverlap(_other, destination))) Fail('TARGET_ALIAS', target.id);
				physicalTargets.push(destination);
				const hasCurrent = backup.mode === 'fixed' && await CheckCurrent(destination, config, target);
				if (_options.dryRun) {
					result = { ...result, status: 'planned', engine, backup, output: path.join(destination, backup.mode === 'fixed' ? 'current' : config.projectId + '--' + runId), replacesCurrent: hasCurrent, files: inventory.files.length, bytes: inventory.files.reduce((_sum, _file) => _sum + _file.size, 0) };
				} else {
					targetLockPath = path.join(destination, '.microgulp-backup.lock');
					targetLock = await fs.open(targetLockPath, 'wx');
					await targetLock.writeFile(JSON.stringify({runId, projectId:config.projectId, targetId:target.id}));
					snapshot = path.join(destination, config.projectId + '--' + runId);
					await fs.mkdir(snapshot);
					await SafeDirectory(snapshot);
					await _WriteNewJson(path.join(snapshot, 'started.json'), { schemaVersion: 1, runId, targetId: target.id, startedAt });
					let archive = null;
					if (backup.format === 'zip') {
						const zipFile = path.join(snapshot, 'project.zip');
						await WriteZip(config.source, zipFile, inventory.files, config.timeoutMs);
						archive = await VerifyZip(zipFile, inventory.files, config.timeoutMs);
					} else {
						let data = path.join(snapshot, 'data');
						await fs.mkdir(data);
						await (_options.copy ?? CopyFiles)({ source: config.source, destination: data, files: inventory.files, engine, timeoutMs: config.timeoutMs });
						await VerifyFiles(data, inventory.files);
					}
					let after = await Inventory(config.source, config.exclusions);
					if (JSON.stringify(after.files) !== JSON.stringify(inventory.files)) Fail('SOURCE_CHANGED');
					let finishedAt = new Date().toISOString();
					await _WriteNewJson(path.join(snapshot, 'manifest.json'), {
						schemaVersion: 1, recipeVersion: GetVersionString(), runId, projectId: config.projectId, targetId: target.id,
						startedAt, finishedAt, status: 'success', engine, backup, archive, configDigest, sourceStatus: status,
						verification: 'sha256', files: inventory.files, exclusions: config.exclusions,
						mandatoryExclusions: { directoryNames: REQUIRED_DIR_EXCLUSIONS, fileNames: REQUIRED_FILE_EXCLUSIONS, patterns: ['.env.*', '*.pem', '*.key', '*.p12', '*.pfx'] },
					});
					let cleanupPending = null;
					if (backup.mode === 'fixed') {
						const published = await PublishFixed(destination, snapshot, config, target, runId);
						snapshot = published.path; cleanupPending = published.cleanupPending;
					}
					result = { ...result, status: 'success', snapshot, backup, cleanupPending, files: inventory.files.length };
				}
			} catch (_error) {
				result.errorCode = _error.code ?? 'BACKUP_FAILED';
				result.snapshot = snapshot;
				if (snapshot) {
					try { await _WriteNewJson(path.join(snapshot, 'failed.json'), { status: 'failed', code: result.errorCode, at: new Date().toISOString() }); }
					catch { result.targetJournalUnavailable = true; }
				}
			} finally {
				if (targetLock) {
					try { await targetLock.close(); await fs.unlink(targetLockPath); }
					catch (_error) {
						result.snapshotStatus = result.status;
						result.status = 'failed';
						result.previousErrorCode = result.errorCode;
						result.errorCode = 'TARGET_LOCK_RELEASE_FAILED';
						result.lockPath = targetLockPath;
					}
				}
			}
			result.finishedAt = new Date().toISOString();
			if (!_options.dryRun) {
				try { await _WriteNewJson(path.join(stateRoot, 'history', runId + '--' + target.id + '.json'), { schemaVersion: 1, runId, ...result }); }
				catch { result.snapshotStatus = result.status; result.status = 'failed'; result.errorCode = 'LOCAL_HISTORY_FAILED'; }
			}
			results.push(result);
			_options.onResult?.(result);
			if (result.status === 'failed' && !config.features.continueOnError) break;
		}
	} finally {
		if (lock) {
			await lock.close();
			// This run owns this local lock.
			await fs.unlink(path.join(stateRoot, 'backup.lock'));
		}
	}
	let report = { runId, dryRun: _options.dryRun, engine, backup, inventory, results };
	if (results.some((_result) => _result.status === 'failed')) throw Object.assign(new Error('BACKUP_PARTIAL_FAILURE'), { code: 'BACKUP_PARTIAL_FAILURE', report });
	return report;
}
