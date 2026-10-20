// Shared recipe release contract. This standalone copy has no host dependency.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT = '<context="release info"/>';

export function ValidateReleases(_data) {
 if (!Array.isArray(_data?.releases) || !_data.releases.length) throw new Error('RELEASES.json needs at least one release.');
 let previous;
 const seen = new Set();
 for (const release of _data.releases) {
  if (!release || ['main', 'minor', 'revision'].some(_key => !Number.isSafeInteger(release[_key]) || release[_key] < 0)
   || typeof release.beta !== 'boolean' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(release.date || '')
   || !Array.isArray(release.info) || !release.info.length || release.info.some(_line => typeof _line !== 'string' || !_line.endsWith(CONTEXT) || !_line.slice(0, -CONTEXT.length).trim())) throw new Error('Invalid release fields or release-info context.');
  const parsedDate = new Date(release.date.replace(' ', 'T') + ':00Z');
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 16).replace('T', ' ') !== release.date) throw new Error('Invalid release date.');
  const key = GetVersionString(release) + ':' + release.beta;
  if (seen.has(key)) throw new Error('Duplicate release version.');
  seen.add(key);
  if (previous) {
   const left = [previous.main, previous.minor, previous.revision, previous.beta ? 0 : 1];
   const right = [release.main, release.minor, release.revision, release.beta ? 0 : 1];
   const index = left.findIndex((_value, _index) => _value !== right[_index]);
   if (index >= 0 && left[index] < right[index]) throw new Error('Releases must be ordered newest version first.');
  }
  previous = release;
 }
 return _data.releases;
}
export function LoadReleases(_root = ROOT) {
 return ValidateReleases(JSON.parse(readFileSync(join(_root, 'RELEASES.json'), 'utf8').replace(/^\uFEFF/, '')));
}
export function GetCurrentRelease(_root = ROOT) { return LoadReleases(_root)[0]; }
export function GetVersionString(_release = GetCurrentRelease()) { return [_release.main, _release.minor, _release.revision].join('.'); }
export function GetFullVersionString(_release = GetCurrentRelease()) { return GetVersionString(_release) + (_release.beta ? 'ß' : ''); }

export function CheckPackageVersions(_root = ROOT, _sync = false) {
 const version = GetVersionString(GetCurrentRelease(_root));
 for (const name of ['package.json', 'package-lock.json']) {
  const file = join(_root, name);
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const mismatch = data.version !== version || (name === 'package-lock.json' && data.packages?.[''] && data.packages[''].version !== version);
  if (!mismatch) continue;
  if (!_sync) throw new Error(name + ' differs from RELEASES.json (' + version + '). Run release:sync.');
  data.version = version;
  if (name === 'package-lock.json' && data.packages?.['']) data.packages[''].version = version;
  writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
 }
 return version;
}
export function GetHistory(_root = ROOT, _locale = 'en-US') {
 if (!/^[a-z]{2}-[A-Z]{2}$/.test(_locale)) throw new Error('Invalid locale.');
 const dictionaryFile = join(_root, 'i18x/gulp', _locale + '.json');
 const dictionary = existsSync(dictionaryFile) ? JSON.parse(readFileSync(dictionaryFile, 'utf8')) : {};
 return LoadReleases(_root).map(_release => 'V' + GetFullVersionString(_release) + ' - ' + _release.date + '\n' + _release.info.map(_line => '- ' + (dictionary[_line] || _line).replace(CONTEXT, '')).join('\n')).join('\n\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const [mode = '--check', ...args] = process.argv.slice(2);
  if (!['--check', '--sync', '--version', '--history'].includes(mode) || args.length > 1 || (args.length && (mode !== '--history' || !args[0].startsWith('--language=')))) throw new Error('Usage: node tools/RecipeRelease.mjs --check|--sync|--version|--history [--language=de-DE]');
  console.log(mode === '--history' ? GetHistory(ROOT, args[0]?.slice(11) || 'en-US') : CheckPackageVersions(ROOT, mode === '--sync'));
 } catch (_error) { console.error(_error.message); process.exitCode = 1; }
}
