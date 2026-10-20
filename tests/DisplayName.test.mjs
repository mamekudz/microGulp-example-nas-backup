import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DisplayName } from '../src/DisplayName.mjs';
import { ValidateConfig } from '../src/Config.mjs';
import { Translate, SetLid } from '../node_modules/gulp-mu-gulp-api/src/i18x.mjs';

test('compact default and independent detail switches use real i18x rendering', () => {
	let config = { features: { dynamicDisplayName: true } };
	const values = { version: '2.3.5', commit: 'abc123', dirty: 1, lastBackup: Date.UTC(2026,9,10,17,24) };
	SetLid('de-DE');
	assert.equal(Translate(DisplayName(config, true), values, 'Europe/Berlin'), 'NAS-Sicherung V2.3.5');
	config.displayName = { version: false, commit: false, changes: true, lastBackup: true };
	assert.equal(Translate(DisplayName(config, true), values, 'Europe/Berlin'), 'NAS-Sicherung | ✎ | 10.10.2026 19:24');
	assert.equal(Translate(DisplayName(config, false), { ...values, dirty: 0 }), 'NAS-Sicherung | ✓');
	assert.equal(Translate(DisplayName(config, false), { ...values, dirty: 2 }), 'NAS-Sicherung | ?');
	for(let mask=0;mask<16;mask++) {
		config.displayName = Object.fromEntries(['version','commit','changes','lastBackup'].map((k,i)=>[k,!!(mask & (1<<i))]));
		for(const lid of ['de-DE','en-US']) {
			SetLid(lid);
			let title=Translate(DisplayName(config,true),values,'Europe/Berlin');
			assert.ok(!/<|true|false|last target|letztes Ziel/.test(title),title);
			assert.equal(title.includes('abc123'),config.displayName.commit);
			assert.equal(title.includes('✎'),config.displayName.changes);
		}
	}
	config.features.dynamicDisplayName=false;
	SetLid('de-DE');assert.equal(Translate(DisplayName(config,true),values),'NAS-Sicherung');
});

test('optional display configuration rejects typos and non-booleans', () => {
	let config=JSON.parse(fs.readFileSync(new URL('../nas-backup.windows.example.json',import.meta.url)));
	assert.doesNotThrow(()=>ValidateConfig(config));
	delete config.displayName; assert.doesNotThrow(()=>ValidateConfig(config));
	config.displayName={changes:'true'};assert.throws(()=>ValidateConfig(config),/CONFIG_BOOLEAN/);
	config.displayName={typo:true};assert.throws(()=>ValidateConfig(config),/CONFIG_UNKNOWN_KEY/);
});
