import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InstallStringExtensions } from 'gulp-mu-gulp-api';
import { RunTask } from '../src/Task.mjs';

InstallStringExtensions();

async function Fixture(_t) {
	let root = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-one-task-schedule-'));
	_t.after(async () => {
		if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('nas-one-task-schedule-')) throw Error('unsafe test cleanup path');
		await fs.rm(root, { recursive: true, force: true });
	});
	let source = path.join(root, 'source'), target = path.join(root, 'nas');
	await fs.mkdir(source); await fs.mkdir(target);
	await fs.writeFile(path.join(source, 'hello.txt'), 'test source');
	await fs.writeFile(path.join(target, '.microgulp-target.json'), JSON.stringify({ schemaVersion: 1, projectId: 'test', targetId: 'primary' }));
	let config = {
		schemaVersion: 1, projectId: 'test', source: 'source', engine: 'node', timeoutMs: 10000,
		features: { git: false, dynamicDisplayName: false, editTargetPaths: false, continueOnError: true, dryRunDefault: true },
		exclusions: { directoryNames: [], relativePaths: [], fileNames: [] },
		targets: [{ id: 'primary', label: 'NAS', path: target, selected: true }],
		backup: { mode: 'fixed', format: 'directory' }, schedule: { enabled: false, cron: '0 2 * * *', dryRun: true },
	};
	let file = path.join(root, 'nas-backup.local.json');
	await fs.writeFile(file, JSON.stringify(config));
	return { root, file, target };
}

function Api(_formAnswer, _reason = 'manual') {
	let calls = { forms: 0, rescans: 0, logs: [] };
	return {
		calls,
		GetTaskRunContext: () => ({ reason: _reason, scheduleId: _reason === 'schedule' ? 'nas-backup-daily' : undefined }),
		RequestForm: async (_form) => { calls.forms++; calls.form = _form; return _formAnswer; },
		NotifyTasksChanged: () => { calls.rescans++; },
		Log: (..._args) => calls.logs.push(_args), Warn: () => {}, LogError: () => {},
	};
}

test('one form persists selected targets and the enabled schedule; scheduled trigger reuses it without a form', async _t => {
	let fixture = await Fixture(_t);
	let manualApi = Api({ targets: ['primary'], mode: 'dry-run', scheduleEnabled: 'enabled', scheduleCron: '15 3 * * *', scheduleMode: 'dry-run', runNow: 'no' });
	assert.deepEqual(await RunTask(fixture.file, manualApi), { scheduleUpdated: true, enabled: true });
	assert.equal(manualApi.calls.forms, 1);
	assert.equal(manualApi.calls.rescans, 1);
	let state = JSON.parse(await fs.readFile(path.join(fixture.root, '.microgulp', 'nas-backup-schedule.json'), 'utf8'));
	assert.deepEqual(state, { enabled: true, cron: '15 3 * * *', targetIds: ['primary'], dryRun: true });
	let scheduledApi = Api(null, 'schedule');
	let result = await RunTask(fixture.file, scheduledApi);
	assert.equal(scheduledApi.calls.forms, 0);
	assert.equal(result.results.length, 1);
	assert.equal(result.results[0].status, 'planned');
	assert.equal(await fs.readdir(fixture.target).then(_entries => _entries.includes('current')), false);
});

test('one form can disable an existing schedule without starting a backup', async _t => {
	let fixture = await Fixture(_t), dir = path.join(fixture.root, '.microgulp');
	await fs.mkdir(dir);
	await fs.writeFile(path.join(dir, 'nas-backup-schedule.json'), JSON.stringify({ enabled: true, cron: '0 2 * * *', targetIds: ['primary'], dryRun: true }));
	let api = Api({ targets: ['primary'], mode: 'dry-run', scheduleEnabled: 'disabled', scheduleCron: '0 2 * * *', scheduleMode: 'dry-run', runNow: 'no' });
	assert.deepEqual(await RunTask(fixture.file, api), { scheduleUpdated: true, enabled: false });
	assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'nas-backup-schedule.json'), 'utf8')).enabled, false);
	assert.equal(api.calls.forms, 1);
});
