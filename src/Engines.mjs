import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Fail } from './Config.mjs';
import { SafeDirectory } from './Inventory.mjs';

export function SelectEngine(_name, _platform = process.platform) {
	let name = _name === 'auto' ? (_platform === 'win32' ? 'robocopy' : 'rsync') : _name;
	if (name === 'robocopy' && _platform !== 'win32') Fail('ENGINE_PLATFORM');
	if (name === 'rsync' && _platform === 'win32') Fail('ENGINE_PLATFORM');
	return name;
}

export function ExitSucceeded(_engine, _code, _signal) {
	return !_signal && Number.isInteger(_code) && (_engine === 'robocopy' ? _code >= 0 && _code < 8 : _code === 0);
}

/** No shell. Wait for close, not exit. Missing codes/signals never mean success. */
export function RunProcess(_command, _args, _options) {
	return new Promise((_resolve, _reject) => {
		let child = spawn(_command, _args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
		let errorText = '', timedOut = false;
		let timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, _options.timeoutMs);
		child.stderr.on('data', (_chunk) => { errorText = (errorText + _chunk.toString()).slice(-8192); });
		child.stdin.on('error', () => {});
		child.once('error', (_error) => { clearTimeout(timer); _reject(_error); });
		child.once('close', (_code, _signal) => {
			clearTimeout(timer);
			if (timedOut || !ExitSucceeded(_options.engine, _code, _signal)) {
				_reject(Object.assign(new Error(timedOut ? 'ENGINE_TIMEOUT' : 'ENGINE_FAILED'), { code: timedOut ? 'ENGINE_TIMEOUT' : 'ENGINE_FAILED', exitCode: _code, signal: _signal, diagnostic: errorText }));
			} else _resolve({ exitCode: _code });
		});
		child.stdin.end(_options.input ?? '');
	});
}

export function RobocopyArgs(_source, _destination, _relative) {
	// Explicit single-file jobs avoid independent engine-specific glob policies.
	if (/[\x00-\x1f*?"<>|]/.test(_relative) || path.basename(_relative).startsWith('/')) Fail('ENGINE_FILENAME', _relative);
	return [path.dirname(path.join(_source, _relative)), path.dirname(path.join(_destination, _relative)), path.basename(_relative), '/COPY:DAT', '/DCOPY:T', '/R:1', '/W:1', '/XJ', '/NP', '/NFL', '/NDL'];
}

export function RsyncArgs(_source, _destination) {
	return ['--relative', '--times', '--from0', '--files-from=-', '--no-links', '--', _source + path.sep, _destination + path.sep];
}

/** Engine contract: copy exactly the inventory into a new empty data directory. */
export async function CopyFiles(_job) {
	let { source, destination, files, engine, timeoutMs } = _job;
	await SafeDirectory(source);
	await SafeDirectory(destination);
	if (engine === 'rsync') {
		return RunProcess('rsync', RsyncArgs(source, destination), { engine, timeoutMs, input: files.map((_file) => _file.path + '\0').join('') });
	}
	let deadline = Date.now() + timeoutMs;
	for (let file of files) {
		if (Date.now() >= deadline) Fail('ENGINE_TIMEOUT');
		let from = path.join(source, file.path), to = path.join(destination, file.path);
		await SafeDirectory(path.dirname(from));
		let stat = await fs.lstat(from);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) Fail('SOURCE_CHANGED', file.path);
		await fs.mkdir(path.dirname(to), { recursive: true });
		await SafeDirectory(path.dirname(to));
		if (engine === 'node') await fs.copyFile(from, to, constants.COPYFILE_EXCL);
		else if (engine === 'robocopy') await RunProcess('robocopy.exe', RobocopyArgs(source, destination, file.path), { engine, timeoutMs: Math.max(1, deadline - Date.now()) });
		else Fail('CONFIG_ENGINE');
	}
	return { exitCode: 0 };
}
