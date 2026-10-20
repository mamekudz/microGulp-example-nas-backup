import path from 'node:path';
import { LoadConfig, Fail } from './src/Config.mjs';
import { ExecuteBackup } from './src/Backup.mjs';

try {
	let args = process.argv.slice(2), values = {}, apply = false;
	while (args.length) {
		let option = args.shift();
		if (option === '--apply' && !apply) apply = true;
		else if (['--config', '--targets'].includes(option) && !Object.hasOwn(values, option) && args.length) values[option] = args.shift();
		else Fail('CLI_ARGUMENT', option);
	}
	if (!values['--config'] || !values['--targets']) Fail('CLI_USAGE', '--config <file> --targets <id,id> [--apply]');
	let config = LoadConfig(path.resolve(values['--config']));
	let report = await ExecuteBackup(config, values['--targets'].split(','), { dryRun: !apply });
	console.log(JSON.stringify(report, null, 2));
} catch (_error) {
	console.error(JSON.stringify({ error: _error.code ?? _error.message, report: _error.report ?? null }, null, 2));
	process.exitCode = 1;
}
