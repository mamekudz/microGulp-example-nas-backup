import fs from 'node:fs';
import path from 'node:path';
import { LoadConfig, ValidateConfig, Fail } from './Config.mjs';
import { ReadStatus, ReadHistory } from './Status.mjs';
import { BackupOptions } from './Storage.mjs';
import { ExecuteBackup } from './Backup.mjs';

const DEFAULT_SCHEDULE = { enabled: false, cron: '0 2 * * *', targetIds: [], dryRun: true };
function _ScheduleFile(_file) { return path.join(path.dirname(_file), '.microgulp', 'nas-backup-schedule.json'); }

function _ReadSchedule(_file, _config) {
	try {
		let state = JSON.parse(fs.readFileSync(_ScheduleFile(_file), 'utf8'));
		return ValidateConfig({ ..._config, schedule: state }).schedule;
	} catch (_error) {
		if (_error.code === 'ENOENT') return { ...DEFAULT_SCHEDULE, ..._config.schedule,
			targetIds: _config.schedule?.targetIds ?? _config.targets.filter((_target) => _target.selected).map((_target) => _target.id) };
		throw _error;
	}
}

function _SaveSchedule(_file, _config, _state) {
	let schedule = ValidateConfig({ ..._config, schedule: _state }).schedule;
	let file = _ScheduleFile(_file);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let temp = file + '.tmp';
	fs.writeFileSync(temp, JSON.stringify(schedule, null, '\t') + '\n', { flag: 'w' });
	fs.renameSync(temp, file);
	return schedule;
}

async function _Execute(_config, _api, _targetIds, _dryRun) {
	try {
		return await ExecuteBackup(_config, _targetIds, { dryRun: _dryRun, onResult: (_result) => {
			if (_result.cleanupPending) _api.Warn('Previous copy could not be removed: <path/><context="task log"/>', { path: _result.cleanupPending });
			_api.Log('Target <id/>: <status/> <code/><context="task log"/>', { id: _result.targetId, status: _result.status, code: _result.errorCode ?? '' });
		} });
	} catch (_error) {
		_api.LogError('Backup failed: <code/><context="task error"/>', { code: _error.code ?? 'BACKUP_FAILED' });
		throw _error;
	} finally { _api.NotifyTasksChanged(); }
}

/** One task: manual form and non-interactive session schedule share settings. */
export async function RunTask(_file, _api) {
	let config = LoadConfig(_file);
	let trigger = _api.GetTaskRunContext?.() ?? { reason: 'manual' };
	let schedule = _ReadSchedule(_file, config);
	if (trigger.reason === 'schedule') {
		if (!schedule.enabled) Fail('SCHEDULE_DISABLED');
		_api.Log('Scheduled backup started. Mode <mode/> / <format/>; dry run <dryRun/>.<context="task log"/>', {
			mode: config.backup?.mode ?? 'fixed', format: config.backup?.format ?? 'directory', dryRun: String(schedule.dryRun),
		});
		return _Execute(config, _api, schedule.targetIds, schedule.dryRun);
	}

	let backup = BackupOptions(config);
	let status = ReadStatus(config), history = ReadHistory(config.source, config.targets);
	_api.Log('Source: <source/> | Version: <version/> | Git: <git/> | Commit: <commit/> | Dirty: <dirty/><context="task log"/>', {
		source: config.source, version: status.version ?? '-', git: status.git, commit: status.commit ?? '-', dirty: status.dirty === null ? '?' : String(status.dirty),
	});
	for (let target of config.targets) _api.Log('Target <id/>: <path/> | Last successful backup: <time/><context="task log"/>', { id: target.id, path: target.path, time: history[target.id].lastSuccess ?? '-' });
	for (let warning of status.warnings) _api.Warn('Metadata warning: <code/><context="task log"/>', { code: warning });
	_api.Log('Backup configuration: <mode/> / <format/>. SHA-256 verification is mandatory.<context="task log"/>', backup);
	let form = {
		title: 'NAS backup<context="task parameter"/>'.i18xRegister(),
		information: {
			title: 'Current status<context="form information"/>'.i18xRegister(),
			message: 'Version <version/> | Git <git/> | Commit <commit/> | Dirty <dirty/><context="form information"/>'.i18xRegister(),
			values: { version: status.version ?? '-', git: status.git, commit: status.commit ?? '-', dirty: status.dirty === null ? '?' : String(status.dirty) },
			items: [
				{ key: 'Source<context="form information"/>'.i18xRegister(), value: config.source },
				{ key: 'Backup configuration<context="form information"/>'.i18xRegister(), value: backup.mode + ' / ' + backup.format },
				{ key: 'Recurring schedule<context="form information"/>'.i18xRegister(), value: schedule.enabled ? schedule.cron + ' | ' + schedule.targetIds.join(', ') : 'Disabled<context="task parameter"/>'.i18xRegister() },
				...config.targets.map((_target) => ({ key: _target.label, value: _target.path + ' | ' + (history[_target.id].lastSuccess ?? '-') })),
			],
		},
		cancelable: true,
		rememberKey: 'nas-backup-v1',
		submitLabel: 'Save and continue<context="button text"/>'.i18xRegister(),
		fields: [
			{ id: 'targets', type: 'checkbox', label: 'Backup targets<context="task parameter"/>'.i18xRegister(), validate: { required: true, minSelected: 1 }, options: config.targets.map((_target) => ({ value: _target.id, label: _target.label + ' (' + _target.id + ')', checked: schedule.targetIds.includes(_target.id) || (!schedule.enabled && _target.selected) })) },
			...(config.features.editTargetPaths ? config.targets.map((_target) => ({ id: 'path-' + _target.id, type: 'folder', remember: false, label: _target.label, default: _target.path })) : []),
			{ id: 'mode', type: 'select', remember: false, label: 'Mode for a backup run<context="task parameter"/>'.i18xRegister(), default: config.features.dryRunDefault ? 'dry-run' : 'apply', options: [
				{ value: 'dry-run', label: 'Preview without writes<context="task parameter"/>'.i18xRegister() },
				{ value: 'apply', label: 'Run verified backup<context="task parameter"/>'.i18xRegister() },
			] },
			{ id: 'scheduleEnabled', type: 'select', remember: false, label: 'Recurring schedule<context="task parameter"/>'.i18xRegister(), default: schedule.enabled ? 'enabled' : 'disabled', options: [
				{ value: 'disabled', label: 'Disabled<context="task parameter"/>'.i18xRegister() },
				{ value: 'enabled', label: 'Enabled<context="task parameter"/>'.i18xRegister() },
			] },
			{ id: 'scheduleCron', type: 'text', remember: false, label: 'Schedule (five-field cron, local time)<context="task parameter"/>'.i18xRegister(), default: schedule.cron },
			{ id: 'scheduleMode', type: 'select', remember: false, label: 'Scheduled run mode<context="task parameter"/>'.i18xRegister(), default: schedule.dryRun ? 'dry-run' : 'apply', options: [
				{ value: 'dry-run', label: 'Preview without writes<context="task parameter"/>'.i18xRegister() },
				{ value: 'apply', label: 'Run verified backup<context="task parameter"/>'.i18xRegister() },
			] },
			{ id: 'runNow', type: 'select', remember: false, label: 'Run backup now as well<context="task parameter"/>'.i18xRegister(), default: 'yes', options: [
				{ value: 'yes', label: 'Yes<context="task parameter"/>'.i18xRegister() },
				{ value: 'no', label: 'No, only update schedule<context="task parameter"/>'.i18xRegister() },
			] },
		],
	};
	let values = await _api.RequestForm(form);
	if (values == null || values.cancelled === true) return { cancelled: true };
	if (!['dry-run', 'apply'].includes(values.mode)) Fail('RUN_MODE_REQUIRED');
	if (!['enabled', 'disabled'].includes(values.scheduleEnabled)) Fail('SCHEDULE_STATE_REQUIRED');
	if (!['dry-run', 'apply'].includes(values.scheduleMode)) Fail('SCHEDULE_MODE_REQUIRED');
	if (!['yes', 'no'].includes(values.runNow)) Fail('RUN_NOW_REQUIRED');
	if (config.features.editTargetPaths) config.targets = config.targets.map((_target) => ({ ..._target, path: values['path-' + _target.id] ?? _target.path }));
	let nextSchedule = {
		enabled: values.scheduleEnabled === 'enabled',
		cron: values.scheduleCron,
		targetIds: values.targets,
		dryRun: values.scheduleMode === 'dry-run',
	};
	_SaveSchedule(_file, config, nextSchedule);
	_api.NotifyTasksChanged();
	if (values.runNow === 'no') return { scheduleUpdated: true, enabled: nextSchedule.enabled };
	return _Execute(config, _api, values.targets, values.mode === 'dry-run');
}
