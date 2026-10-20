import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ValidateConfig } from '../src/Config.mjs';
import { Inventory, PathsOverlap, VerifyFiles } from '../src/Inventory.mjs';
import { ExecuteBackup } from '../src/Backup.mjs';
import { ReadStatus, ReadHistory } from '../src/Status.mjs';
import { ExitSucceeded, RobocopyArgs, RsyncArgs, RunProcess } from '../src/Engines.mjs';

async function Fixture(_count = 2) {
	let base = process.env.RECIPE_TEST_ROOT ?? os.tmpdir();
	await fs.mkdir(base, { recursive: true });
	let root = await fs.mkdtemp(path.join(base, 'nas-recipe-'));
	let source = path.join(root, 'source');
	await fs.mkdir(source);
	await fs.writeFile(path.join(source, 'hello.txt'), 'hello');
	let targets = [];
	for (let index = 0; index < _count; index++) {
		let id = 'target-' + index, destination = path.join(root, id);
		await fs.mkdir(destination);
		await fs.writeFile(path.join(destination, '.microgulp-target.json'), JSON.stringify({ schemaVersion: 1, projectId: 'test', targetId: id }));
		targets.push({ id, label: id, path: destination, selected: true });
	}
	return { root, schemaVersion: 1, projectId: 'test', source, engine: 'node', timeoutMs: 10000,
		features: { git: false, dynamicDisplayName: true, editTargetPaths: true, continueOnError: true, dryRunDefault: true },
		exclusions: { directoryNames: [], relativePaths: ['build'], fileNames: [] }, targets };
}

function Config(_fixture) {
	let { root, ...config } = _fixture;
	return config;
}

test('configuration rejects unknown fields, wrong booleans, traversal and duplicate IDs', async () => {
	let config = Config(await Fixture());
	assert.throws(() => ValidateConfig({ ...config, typo: true }), /CONFIG_UNKNOWN_KEY/);
	assert.throws(() => ValidateConfig({ ...config, features: { ...config.features, git: 'false' } }), /CONFIG_BOOLEAN/);
	assert.throws(() => ValidateConfig({ ...config, exclusions: { ...config.exclusions, relativePaths: ['../escape'] } }), /CONFIG_EXCLUSION_PATH/);
	assert.throws(() => ValidateConfig({ ...config, targets: [config.targets[0], config.targets[0]] }), /CONFIG_TARGET_ID/);
});

test('schedule configuration requires valid five-field cron and known unique targets', async () => {
	let config = Config(await Fixture());
	let schedule = { enabled: false, cron: '0 2 * * *', targetIds: ['target-0'], dryRun: true };
	assert.deepEqual(ValidateConfig({ ...config, schedule }).schedule, schedule);
	assert.throws(() => ValidateConfig({ ...config, schedule: { ...schedule, cron: 'tomorrow' } }), /CONFIG_SCHEDULE_CRON/);
	assert.throws(() => ValidateConfig({ ...config, schedule: { ...schedule, cron: '99 2 * * *' } }), /CONFIG_SCHEDULE_CRON/);
	assert.throws(() => ValidateConfig({ ...config, schedule: { ...schedule, targetIds: ['missing'] } }), /CONFIG_SCHEDULE_TARGETS/);
	assert.throws(() => ValidateConfig({ ...config, schedule: { ...schedule, targetIds: ['target-0', 'target-0'] } }), /CONFIG_SCHEDULE_TARGETS/);
});

test('four targets remain selectable; only selected target receives a snapshot', async () => {
	let config = Config(await Fixture(4));
	let report = await ExecuteBackup(config, ['target-3'], { dryRun: false });
	assert.equal(report.results.length, 1);
	assert.equal(report.results[0].status, 'success');
	assert.equal((await fs.readdir(config.targets[0].path)).length, 1);
	assert.equal(await fs.readFile(path.join(report.results[0].snapshot, 'data', 'hello.txt'), 'utf8'), 'hello');
});

test('dry run performs no writes to source, targets, manifests or history', async () => {
	let config = Config(await Fixture());
	let beforeSource = await fs.readdir(config.source), beforeTarget = await fs.readdir(config.targets[0].path);
	let report = await ExecuteBackup(config, ['target-0'], { dryRun: true });
	assert.equal(report.results[0].status, 'planned');
	assert.deepEqual(await fs.readdir(config.source), beforeSource);
	assert.deepEqual(await fs.readdir(config.targets[0].path), beforeTarget);
});

test('no target, unknown IDs and missing run mode fail before copy', async () => {
	let config = Config(await Fixture());
	await assert.rejects(ExecuteBackup(config, [], { dryRun: false }), /TARGET_SELECTION/);
	await assert.rejects(ExecuteBackup(config, ['other'], { dryRun: false }), /TARGET_SELECTION/);
	await assert.rejects(ExecuteBackup(config, ['target-0']), /RUN_MODE_REQUIRED/);
});

test('source, parent, descendant and overlapping targets are rejected', async () => {
	let config = Config(await Fixture());
	for (let unsafe of [config.source, path.dirname(config.source), path.join(config.source, 'inside'), path.parse(config.source).root]) {
		await assert.rejects(ExecuteBackup({ ...config, targets: [{ ...config.targets[0], path: unsafe }] }, ['target-0'], { dryRun: true }), /TARGET_OVERLAP/);
	}
	assert.equal(PathsOverlap('/a/b', '/a/bc'), false);
	let targets = [config.targets[0], { ...config.targets[1], path: path.join(config.targets[0].path, 'nested') }];
	await assert.rejects(ExecuteBackup({ ...config, targets }, targets.map((_t) => _t.id), { dryRun: true }), /TARGET_OVERLAP/);
});

test('missing target is not created; wrong identity marker is rejected', async () => {
	let config = Config(await Fixture());
	config.targets[0].path = path.join(path.dirname(config.source), 'missing');
	await assert.rejects(ExecuteBackup(config, ['target-0'], { dryRun: true }), /BACKUP_PARTIAL_FAILURE/);
	await assert.rejects(fs.stat(config.targets[0].path), { code: 'ENOENT' });
	await fs.writeFile(path.join(config.targets[1].path, '.microgulp-target.json'), '{}');
	await assert.rejects(ExecuteBackup(config, ['target-1'], { dryRun: true }), /BACKUP_PARTIAL_FAILURE/);
});

test('exclusions are root-relative where declared; valuable ignored sources remain', async () => {
	let config = Config(await Fixture());
	for (let dir of ['build', 'src/build', 'node_modules', '.git', 'notes']) await fs.mkdir(path.join(config.source, dir), { recursive: true });
	for (let file of ['build/output.txt', 'src/build/source.txt', 'node_modules/cache.txt', '.git/config', '.env.production', 'private.key', 'notes/ignored.txt']) await fs.writeFile(path.join(config.source, file), 'test');
	let inventory = await Inventory(config.source, config.exclusions);
	assert.deepEqual(inventory.files.map((_f) => _f.path), ['hello.txt', 'notes/ignored.txt', 'src/build/source.txt']);
});

test('junction source and target paths fail closed', async () => {
	let fixture = await Fixture(), config = Config(fixture);
	let alias = path.join(fixture.root, 'alias');
	await fs.symlink(config.targets[0].path, alias, process.platform === 'win32' ? 'junction' : 'dir');
	config.targets[0].path = alias;
	await assert.rejects(ExecuteBackup(config, ['target-0'], { dryRun: true }), /BACKUP_PARTIAL_FAILURE/);
	await fs.symlink(config.targets[1].path, path.join(config.source, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(Inventory(config.source, config.exclusions), /UNSUPPORTED_FILE_TYPE/);
});

test('hardlinks are rejected before backup', async () => {
	let config = Config(await Fixture());
	await fs.link(path.join(config.source, 'hello.txt'), path.join(config.source, 'alias.txt'));
	await assert.rejects(Inventory(config.source, config.exclusions), /HARDLINK_NOT_SUPPORTED/);
});

test('second snapshot preserves original file content and records per-target history', async () => {
	let config = Config(await Fixture()); config.backup = {mode:'snapshots',format:'directory'};
	let first = await ExecuteBackup(config, ['target-0'], { dryRun: false });
	await fs.writeFile(path.join(config.source, 'hello.txt'), 'changed');
	let second = await ExecuteBackup(config, ['target-0'], { dryRun: false });
	assert.notEqual(first.results[0].snapshot, second.results[0].snapshot);
	assert.equal(await fs.readFile(path.join(first.results[0].snapshot, 'data', 'hello.txt'), 'utf8'), 'hello');
	let manifest = JSON.parse(await fs.readFile(path.join(second.results[0].snapshot, 'manifest.json'), 'utf8'));
	assert.equal(manifest.status, 'success');
	assert.equal(manifest.files[0].sha256.length, 64);
	assert.equal(ReadHistory(config.source, config.targets)['target-0'].records, 2);
});

test('copy failure does not advance last success; next target continues', async () => {
	let config = Config(await Fixture());
	await ExecuteBackup(config, ['target-0'], { dryRun: false });
	let before = ReadHistory(config.source, config.targets)['target-0'].lastSuccess;
	let count = 0;
	let { CopyFiles } = await import('../src/Engines.mjs');
	await assert.rejects(ExecuteBackup(config, ['target-0', 'target-1'], { dryRun: false, copy: async (_job) => {
		if (++count === 1) throw Object.assign(new Error('offline'), { code: 'EIO' });
		return CopyFiles(_job);
	} }), (_error) => {
		assert.deepEqual(_error.report.results.map((_r) => _r.status), ['failed', 'success']);
		return true;
	});
	assert.equal(ReadHistory(config.source, config.targets)['target-0'].lastSuccess, before);
});

test('fail-fast stops subsequent targets', async () => {
	let config = Config(await Fixture()); config.features.continueOnError = false;
	await assert.rejects(ExecuteBackup(config, ['target-0', 'target-1'], { dryRun: false, copy: async () => { throw new Error('fail'); } }), (_error) => _error.report.results.length === 1);
	assert.equal((await fs.readdir(config.targets[1].path)).length, 1);
});

test('corrupt destination or modified source cannot produce a success manifest', async () => {
	for (let mutateSource of [false, true]) {
		let config = Config(await Fixture());
		await assert.rejects(ExecuteBackup(config, ['target-0'], { dryRun: false, copy: async (_job) => {
			await fs.writeFile(path.join(_job.destination, 'hello.txt'), mutateSource ? 'hello' : 'bad');
			if (mutateSource) await fs.writeFile(path.join(config.source, 'new.txt'), 'new');
		} }), (_error) => {
			assert.equal(_error.report.results[0].status, 'failed');
			return true;
		});
		let snapshot = (await fs.readdir(config.targets[0].path)).find((_name) => _name.startsWith('test--'));
		await assert.rejects(fs.stat(path.join(config.targets[0].path, snapshot, 'manifest.json')), { code: 'ENOENT' });
	}
});

test('an existing lock is never removed or reused', async () => {
	let config = Config(await Fixture());
	await fs.mkdir(path.join(config.source, '.recipe-state'));
	await fs.writeFile(path.join(config.source, '.recipe-state', 'backup.lock'), 'other process');
	await assert.rejects(ExecuteBackup(config, ['target-0'], { dryRun: false }), { code: 'EEXIST' });
	assert.equal(await fs.readFile(path.join(config.source, '.recipe-state', 'backup.lock'), 'utf8'), 'other process');
});

test('robocopy codes 0..7 succeed, null/signal/8 fail; rsync 23 fails', () => {
	for (let code = 0; code < 8; code++) assert.equal(ExitSucceeded('robocopy', code, null), true);
	for (let code of [null, undefined, -1, 8]) assert.equal(ExitSucceeded('robocopy', code, null), false);
	assert.equal(ExitSucceeded('robocopy', 0, 'SIGTERM'), false);
	assert.equal(ExitSucceeded('rsync', 23, null), false);
	assert.equal(ExitSucceeded('rsync', 0, null), true);
});

test('native commands contain no mirror/delete/purge switches', () => {
	let args = [...RobocopyArgs('C:\\source', 'C:\\dest', 'hello.txt'), ...RsyncArgs('/source', '/dest')];
	assert.equal(args.some((_arg) => /^(\/MIR|\/PURGE|\/MOVE|--delete)/i.test(_arg)), false);
});

test('process errors and timeout reject', async () => {
	await assert.rejects(RunProcess('missing-microgulp-test-command', [], { engine: 'rsync', timeoutMs: 1000 }));
	await assert.rejects(RunProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { engine: 'rsync', timeoutMs: 100 }), /ENGINE_TIMEOUT/);
});

test('no Git, unborn Git, clean commit and dirty worktree are distinguished', async () => {
	let config = Config(await Fixture()); config.features.git = true;
	let git = (_args) => execFileSync('git', ['-C', config.source, ..._args], { stdio: 'pipe' });
	assert.equal(ReadStatus(config).git, 'none');
	git(['init']);
	assert.equal(ReadStatus(config).git, 'unborn');
	git(['add', 'hello.txt']);
	git(['-c', 'user.name=Recipe Test', '-c', 'user.email=recipe@example.invalid', 'commit', '-m', 'fixture']);
	assert.equal(ReadStatus(config).dirty, false);
	assert.equal(ReadStatus(config).commit.length, 12);
	await fs.writeFile(path.join(config.source, 'untracked.txt'), 'dirty');
	assert.equal(ReadStatus(config).dirty, true);
	await fs.writeFile(path.join(config.source, 'RELEASES.json'), JSON.stringify({ releases: [{ main: 2, minor: 3, revision: 4, beta: true }] }));
	assert.equal(ReadStatus(config).version, '2.3.4ß');
});

test('native platform engine copies and verifies local fixture', async () => {
	let config = Config(await Fixture()); config.engine = 'auto';
	await fs.mkdir(path.join(config.source, 'folder with spaces'));
	await fs.writeFile(path.join(config.source, 'folder with spaces', 'Übung & sample.txt'), 'native');
	let report = await ExecuteBackup(config, ['target-0'], { dryRun: false });
	assert.equal(report.results[0].status, 'success');
});

test('task emits status before exactly one form, uses genuine checkbox API, and cancels without writes', async () => {
	let api = await import('gulp-mu-gulp-api'); api.InstallStringExtensions();
	let { RunTask } = await import('../src/Task.mjs');
	let config = Config(await Fixture(4)), events = [];
	let file = path.join(path.dirname(config.source), 'config.json');
	await fs.writeFile(file, JSON.stringify(config));
	let result = await RunTask(file, { ...api, Log: () => events.push('log'), RequestForm: async (_form) => {
		events.push('form');
		assert.equal(_form.fields[0].type, 'checkbox');
		assert.equal(_form.fields[0].options.length, 4);
		assert.equal(_form.information.values.git, 'disabled');
		assert.equal(_form.cancelable, true);
		assert.equal(_form.rememberKey, 'nas-backup-v1');
		assert.equal(_form.fields.find((_field) => _field.id === 'mode').remember, false);
		assert.equal(_form.fields.find((_field) => _field.id === 'mode').default, 'dry-run');
		return null;
	} });
	assert.equal(result.cancelled, true);
	assert.equal(events.filter((_event) => _event === 'form').length, 1);
	assert.equal(events[0], 'log');
	assert.equal(events.at(-1), 'form');
	await assert.rejects(fs.stat(path.join(config.source, '.recipe-state')), { code: 'ENOENT' });
});

test('a verified snapshot can be restored and hash-checked in a separate empty directory', async () => {
	let fixture = await Fixture(), config = Config(fixture);
	let report = await ExecuteBackup(config, ['target-0'], { dryRun: false });
	let snapshot = report.results[0].snapshot;
	let manifest = JSON.parse(await fs.readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
	let restore = path.join(fixture.root, 'restore');
	await fs.cp(path.join(snapshot, 'data'), restore, { recursive: true, errorOnExist: true, force: false });
	await VerifyFiles(restore, manifest.files);
	assert.equal(await fs.readFile(path.join(restore, 'hello.txt'), 'utf8'), 'hello');
});

test('real API CLI checkbox fallback returns option IDs and task has no pre-run form', async () => {
	let api = await import('gulp-mu-gulp-api');
	let values = await api.RequestForm({ fields: [{ id: 'targets', type: 'checkbox', options: [{ value: 'primary', checked: true }, { value: 'secondary', checked: false }] }] });
	assert.deepEqual(values.targets, ['primary']);
	let { BACKUP_TO_NAS } = await import('../gulpfile.mjs');
	assert.equal(BACKUP_TO_NAS.µParameters, undefined);
	assert.equal(typeof BACKUP_TO_NAS.µDisplayName(), 'string');
	await assert.rejects(BACKUP_TO_NAS(), /Use npm run backup/);
});
