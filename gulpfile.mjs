import { CheckPackageVersions, GetVersionString } from './tools/RecipeRelease.mjs';
CheckPackageVersions();
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Api from 'gulp-mu-gulp-api';
import { LoadConfig, ValidateConfig } from './src/Config.mjs';
import { DisplayName } from './src/DisplayName.mjs';
import { ReadStatus, ReadHistory } from './src/Status.mjs';

Api.InstallStringExtensions();
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(ROOT, 'nas-backup.local.json');
const SCHEDULE_STATE = path.join(ROOT, '.microgulp', 'nas-backup-schedule.json');

// Requires the host's optional GetValues snapshot support (see README).
export const µI18xContext = { GetValues: _ReadContext };

function _ReadContext() {
	let displayContext = { recipeVersion: GetVersionString(), version: '-', commit: '-', dirty: 2, lastBackup: 0 };
	try {
		let config = LoadConfig(CONFIG);
		if (!config.features.dynamicDisplayName) return displayContext;
		let status = ReadStatus(config), history = ReadHistory(config.source, config.targets);
		let times = Object.values(history).map((_item) => _item.lastSuccess).filter(Boolean).sort();
		displayContext = { recipeVersion: GetVersionString(), version: status.version ?? '-', commit: status.commit ?? '-', dirty: status.dirty === null ? 2 : Number(status.dirty), lastBackup: Date.parse(times.at(-1) ?? '') || 0 };
	} catch { /* Discovery remains available before configuration. */ }
	return displayContext;
}

function _DisplayName() {
	try {
		let config = LoadConfig(CONFIG);
		let context = _ReadContext();
		return DisplayName(config, context.lastBackup > 0).i18xRegister();
	} catch { return 'NAS backup - configure first<context="µDisplayName"/>'.i18xRegister(); }
}

export async function BACKUP_TO_NAS() {
	if (!Api.IsMicroGulp()) throw new Error('Use npm run backup -- --config <file> --targets <ids> [--apply] outside the dashboard.');
	let { RunTask } = await import('./src/Task.mjs');
	return RunTask(CONFIG, Api);
}
BACKUP_TO_NAS.µKeyBinding = { key: 'ctrl+shift+F3', mac: 'cmd+shift+F3' };
BACKUP_TO_NAS.µDisplayName = _DisplayName;
BACKUP_TO_NAS.µDescription = 'Creates verified backups for selected targets using the configured mode and format.<context="µDescription"/>'.i18xRegister();
BACKUP_TO_NAS.µTooltip = 'Shows status before one form. Preview is the default. Paths changed in the form apply to this run only.<context="µTooltip"/>'.i18xRegister();
BACKUP_TO_NAS.µGroup = 'Maintenance/Backup<context="µGroup"/>'.i18xRegister();
BACKUP_TO_NAS.µOrder = 80;
BACKUP_TO_NAS.µExecutionConcurrency = false;

function _ReadScheduleState() {
	try {
		let state = JSON.parse(fs.readFileSync(SCHEDULE_STATE, 'utf8'));
		ValidateConfig({ ...LoadConfig(CONFIG), schedule: state });
		return state;
	} catch { return null; }
}
BACKUP_TO_NAS.µSchedule = () => {
	let state = _ReadScheduleState();
	return state?.enabled ? { cron: state.cron, autoStart: true } : false;
};
