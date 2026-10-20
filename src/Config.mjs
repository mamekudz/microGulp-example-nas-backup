import fs from 'node:fs';
import path from 'node:path';

export function Fail(_code, _detail = '') {
	throw Object.assign(new Error(_code + (_detail ? ': ' + _detail : '')), { code: _code });
}

function _Keys(_object, _allowed, _name, _optional = []) {
	if (!_object || typeof _object !== 'object' || Array.isArray(_object)) Fail('CONFIG_OBJECT', _name);
	for (let key of Object.keys(_object)) if (!_allowed.includes(key)) Fail('CONFIG_UNKNOWN_KEY', _name + '.' + key);
	for (let key of _allowed) if (!_optional.includes(key) && !Object.hasOwn(_object, key)) Fail('CONFIG_MISSING_KEY', _name + '.' + key);
}

function _Text(_value) {
	return typeof _value === 'string' && _value.trim() === _value && _value.length > 0 && !/[\x00-\x1f]/.test(_value);
}

function _ValidCronField(_field, _min, _max) {
	return _field.split(',').every((_part) => {
		let match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(_part);
		if (!match) return false;
		if (match[2] !== undefined && Number(match[2]) < 1) return false;
		if (match[1] === '*') return true;
		let range = match[1].split('-').map(Number);
		return range.length <= 2
			&& range.every((_value) => Number.isInteger(_value) && _value >= _min && _value <= _max)
			&& (range.length === 1 || range[0] <= range[1]);
	});
}

function _ValidCron(_cron) {
	if (typeof _cron !== 'string' || _cron.trim() !== _cron) return false;
	let fields = _cron.split(/\s+/);
	let ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
	return fields.length === 5 && fields.every((_field, _index) => _ValidCronField(_field, ...ranges[_index]));
}

export function ValidateConfig(_config) {
	_Keys(_config, ['schemaVersion', 'projectId', 'source', 'engine', 'timeoutMs', 'features', 'exclusions', 'targets', 'displayName', 'backup', 'schedule'], 'config', ['displayName', 'backup', 'schedule']);
	if (Object.hasOwn(_config, 'backup')) {
		_Keys(_config.backup, ['mode', 'format'], 'backup', ['mode', 'format']);
		if (_config.backup.mode !== undefined && !['fixed', 'snapshots'].includes(_config.backup.mode)) Fail('CONFIG_BACKUP_MODE');
		if (_config.backup.format !== undefined && !['directory', 'zip'].includes(_config.backup.format)) Fail('CONFIG_BACKUP_FORMAT');
	}
	if (Object.hasOwn(_config, 'displayName')) {
		_Keys(_config.displayName, ['version', 'commit', 'changes', 'lastBackup'], 'displayName', ['version', 'commit', 'changes', 'lastBackup']);
		for (let value of Object.values(_config.displayName)) if (typeof value !== 'boolean') Fail('CONFIG_BOOLEAN', 'displayName');
	}
	if (Object.hasOwn(_config, 'schedule')) {
		_Keys(_config.schedule, ['enabled', 'cron', 'targetIds', 'dryRun'], 'schedule', ['targetIds']);
		if (typeof _config.schedule.enabled !== 'boolean' || typeof _config.schedule.dryRun !== 'boolean') Fail('CONFIG_BOOLEAN', 'schedule');
		if (!_ValidCron(_config.schedule.cron)) Fail('CONFIG_SCHEDULE_CRON');
		if (_config.schedule.targetIds !== undefined) {
			if (!Array.isArray(_config.schedule.targetIds) || !_config.schedule.targetIds.length || new Set(_config.schedule.targetIds).size !== _config.schedule.targetIds.length) Fail('CONFIG_SCHEDULE_TARGETS');
			for (let id of _config.schedule.targetIds) if (!_Text(id) || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) Fail('CONFIG_SCHEDULE_TARGETS', String(id));
		}
	}
	if (_config.schemaVersion !== 1) Fail('CONFIG_VERSION');
	if (!/^[a-z][a-z0-9-]{0,63}$/.test(_config.projectId ?? '')) Fail('CONFIG_PROJECT_ID');
	if (!_Text(_config.source)) Fail('CONFIG_SOURCE');
	if (!['auto', 'node', 'robocopy', 'rsync'].includes(_config.engine)) Fail('CONFIG_ENGINE');
	if (!Number.isInteger(_config.timeoutMs) || _config.timeoutMs < 1000 || _config.timeoutMs > 86400000) Fail('CONFIG_TIMEOUT');
	_Keys(_config.features, ['git', 'dynamicDisplayName', 'editTargetPaths', 'continueOnError', 'dryRunDefault'], 'features');
	for (let value of Object.values(_config.features)) if (typeof value !== 'boolean') Fail('CONFIG_BOOLEAN');
	_Keys(_config.exclusions, ['directoryNames', 'relativePaths', 'fileNames'], 'exclusions');
	for (let [key, values] of Object.entries(_config.exclusions)) {
		if (!Array.isArray(values) || new Set(values).size !== values.length) Fail('CONFIG_EXCLUSIONS', key);
		for (let value of values) {
			if (!_Text(value) || /[\\:*?"<>|]/.test(value) || value.startsWith('/') || value.split('/').some((_part) => !_part || _part === '.' || _part === '..')) Fail('CONFIG_EXCLUSION_PATH', value);
			if (key !== 'relativePaths' && value.includes('/')) Fail('CONFIG_EXCLUSION_NAME', value);
		}
	}
	if (!Array.isArray(_config.targets) || !_config.targets.length) Fail('CONFIG_TARGETS');
	let ids = new Set();
	for (let target of _config.targets) {
		_Keys(target, ['id', 'label', 'path', 'selected'], 'target');
		if (!/^[a-z][a-z0-9-]{0,63}$/.test(target.id ?? '') || ids.has(target.id)) Fail('CONFIG_TARGET_ID');
		ids.add(target.id);
		if (!_Text(target.label) || !_Text(target.path) || !path.isAbsolute(target.path) || typeof target.selected !== 'boolean') Fail('CONFIG_TARGET', target.id);
	}
	if (_config.schedule?.targetIds?.some((_id) => !ids.has(_id))) Fail('CONFIG_SCHEDULE_TARGETS', 'unknown target id');
	return _config;
}

export function LoadConfig(_file) {
	let config = ValidateConfig(JSON.parse(fs.readFileSync(_file, 'utf8')));
	return { ...config, source: path.resolve(path.dirname(_file), config.source) };
}
