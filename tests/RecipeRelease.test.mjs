import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidateReleases, GetVersionString, GetFullVersionString, CheckPackageVersions, GetHistory } from '../tools/RecipeRelease.mjs';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RELEASE = { main: 1, minor: 10, revision: 0, date: '2026-10-10 12:00', beta: false, info: ['Improved the example.<context="release info"/>'] };
test('own release metadata and package versions agree', () => { assert.match(CheckPackageVersions(ROOT), /^\d+\.\d+\.\d+$/); });
test('release history validates numeric order, duplicates, dates and translation context', () => {
 assert.equal(GetVersionString(RELEASE), '1.10.0');
 assert.equal(GetFullVersionString({ ...RELEASE, beta: true }), '1.10.0ß');
 assert.equal(ValidateReleases({ releases: [RELEASE, { ...RELEASE, minor: 9 }] }).length, 2);
 for (const releases of [[RELEASE, RELEASE], [{ ...RELEASE, minor: 9 }, RELEASE], [{ ...RELEASE, date: '2026-02-30 12:00' }], [{ ...RELEASE, info: ['Missing context'] }]]) assert.throws(() => ValidateReleases({ releases }));
});
test('sync updates only package root versions and check is read-only', () => {
 const root = mkdtempSync(join(tmpdir(), 'recipe-release-test-'));
 writeFileSync(join(root, 'RELEASES.json'), JSON.stringify({ releases: [RELEASE] }));
 writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0', name: 'demo' }));
 writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/other': { version: '2.0.0' } } }));
 assert.throws(() => CheckPackageVersions(root), /differs/);
 assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '1.0.0');
 CheckPackageVersions(root, true);
 assert.equal(CheckPackageVersions(root), '1.10.0');
 assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages['node_modules/other'].version, '2.0.0');
 assert.doesNotMatch(GetHistory(root), /<context=/);
});
