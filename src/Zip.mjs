import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import yazl from 'yazl';
import yauzl from 'yauzl';
import {SafeDirectory, HashFile} from './Inventory.mjs';
import {Fail} from './Config.mjs';

export async function WriteZip(_source, _file, _files, _timeoutMs) {
	const zip = new yazl.ZipFile();
	const output = createWriteStream(_file, {flags:'wx'});
	zip.on('error', _error => zip.outputStream.destroy(_error));
	const completion = pipeline(zip.outputStream, output);
	// Attach the error handler immediately, including during asynchronous validation.
	completion.catch(() => {});
	const timer = setTimeout(() => zip.outputStream.destroy(Object.assign(new Error('ZIP_TIMEOUT'), {code:'ZIP_TIMEOUT'})), _timeoutMs);
	try {
		for (const file of _files) {
			const source = path.join(_source, file.path);
			await SafeDirectory(path.dirname(source));
			const stat = await fs.lstat(source);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size !== file.size) Fail('SOURCE_CHANGED', file.path);
			zip.addFile(source, file.path, {compress:true});
		}
		zip.end(); await completion;
	} catch (_error) { zip.outputStream.destroy(_error); await completion.catch(() => {}); throw _error; }
	finally { clearTimeout(timer); }
}

/** Read back every decompressed entry without extracting untrusted paths. */
export async function VerifyZip(_file, _files, _timeoutMs) {
	const zip = await yauzl.openPromise(_file, {strictFileNames:true});
	const expected = new Map(_files.map(_entry => [_entry.path, _entry]));
	let active, timedOut = false;
	const timer = setTimeout(() => { timedOut = true; active?.destroy(new Error('ZIP_TIMEOUT')); zip.close(); }, _timeoutMs);
	try {
		for await (const entry of zip.eachEntry()) {
			const file = expected.get(entry.fileName);
			if (!file || entry.uncompressedSize !== file.size) Fail('ZIP_CONTENT');
			active = await zip.openReadStreamPromise(entry);
			const hash = createHash('sha256'); let size = 0;
			for await (const chunk of active) { size += chunk.length; hash.update(chunk); }
			active = null;
			if (size !== file.size || hash.digest('hex') !== file.sha256) Fail('ZIP_VERIFY_FAILED', file.path);
			expected.delete(entry.fileName);
		}
		if (timedOut) Fail('ZIP_TIMEOUT');
		if (expected.size) Fail('ZIP_CONTENT');
	} finally { clearTimeout(timer); active?.destroy(); zip.close(); }
	return {file:'project.zip',sha256:await HashFile(_file)};
}
