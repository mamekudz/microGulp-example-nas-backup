import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ExecuteBackup} from '../src/Backup.mjs';
import {ValidateConfig} from '../src/Config.mjs';
import {VerifyZip} from '../src/Zip.mjs';

async function Fixture(_t, _backup) {
	const root=await fs.mkdtemp(path.join(os.tmpdir(),'nas-modes-'));
	_t.after(async()=>{ if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('nas-modes-'))throw Error('cleanup path'); await fs.rm(root,{recursive:true,force:true}); });
	const source=path.join(root,'source'),destination=path.join(root,'target');
	await fs.mkdir(source);await fs.mkdir(destination);
	await fs.writeFile(path.join(source,'Ä space.txt'),'version 1');
	await fs.writeFile(path.join(source,'.env'),'secret');
	await fs.writeFile(path.join(destination,'.microgulp-target.json'),JSON.stringify({schemaVersion:1,projectId:'test',targetId:'one'}));
	return {schemaVersion:1,projectId:'test',source,engine:'node',timeoutMs:10000,...(_backup?{backup:_backup}:{}),features:{git:false,dynamicDisplayName:true,editTargetPaths:false,continueOnError:true,dryRunDefault:true},exclusions:{directoryNames:[],fileNames:[],relativePaths:[]},targets:[{id:'one',label:'One',path:destination,selected:true}]};
}

for(const mode of ['fixed','snapshots'])for(const format of ['directory','zip'])test(mode+' / '+format+' produces verified output; preview has no writes',async _t=>{
	const config=await Fixture(_t,{mode,format});
	const before=await fs.readdir(config.targets[0].path);
	const preview=await ExecuteBackup(config,['one'],{dryRun:true});assert.deepEqual(preview.backup,{mode,format});assert.equal(preview.results[0].replacesCurrent,false);assert.deepEqual(await fs.readdir(config.targets[0].path),before);
	const first=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	let manifest=JSON.parse(await fs.readFile(path.join(first,'manifest.json')));assert.deepEqual(manifest.files.map(_f=>_f.path),['Ä space.txt']);
	if(format==='zip')await VerifyZip(path.join(first,'project.zip'),manifest.files,10000);
	else assert.equal(await fs.readFile(path.join(first,'data/Ä space.txt'),'utf8'),'version 1');
	await fs.unlink(path.join(config.source,'Ä space.txt'));await fs.writeFile(path.join(config.source,'new.txt'),'version 2');
	assert.equal((await ExecuteBackup(config,['one'],{dryRun:true})).results[0].replacesCurrent,mode==='fixed');
	const second=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	assert.equal(first===second,mode==='fixed');manifest=JSON.parse(await fs.readFile(path.join(second,'manifest.json')));assert.deepEqual(manifest.files.map(_f=>_f.path),['new.txt']);
	if(format==='zip')await VerifyZip(path.join(second,'project.zip'),manifest.files,10000);
	else await assert.rejects(fs.stat(path.join(second,'data/Ä space.txt')),{code:'ENOENT'});
	if(mode==='snapshots')assert.ok(await fs.stat(path.join(first,'manifest.json')));
});

test('missing options default to fixed directory; failed replacement preserves current',async _t=>{
	const config=await Fixture(_t);const first=await ExecuteBackup(config,['one'],{dryRun:false});assert.deepEqual(first.backup,{mode:'fixed',format:'directory'});
	const original=await fs.readFile(path.join(first.results[0].snapshot,'manifest.json'),'utf8');
	await assert.rejects(ExecuteBackup(config,['one'],{dryRun:false,copy:async()=>{throw Error('offline');}}));
	assert.equal(await fs.readFile(path.join(first.results[0].snapshot,'manifest.json'),'utf8'),original);
});

test('switching format replaces only current; snapshots and unrelated target files survive',async _t=>{
	const config=await Fixture(_t,{mode:'snapshots',format:'directory'});
	const snapshot=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	await fs.writeFile(path.join(config.targets[0].path,'unrelated.txt'),'keep');
	config.backup={mode:'fixed',format:'directory'};await ExecuteBackup(config,['one'],{dryRun:false});
	config.backup.format='zip';const current=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	await assert.rejects(fs.stat(path.join(current,'data')),{code:'ENOENT'});
	assert.ok(await fs.stat(path.join(snapshot,'data')));assert.equal(await fs.readFile(path.join(config.targets[0].path,'unrelated.txt'),'utf8'),'keep');
});

test('unknown mode, foreign current and foreign target lock fail closed',async _t=>{
	const config=await Fixture(_t);assert.throws(()=>ValidateConfig({...config,backup:{mode:'typo'}}));assert.throws(()=>ValidateConfig({...config,backup:{format:'tar'}}));assert.throws(()=>ValidateConfig({...config,backup:{extra:true}}));
	const current=path.join(config.targets[0].path,'current');await fs.mkdir(current);await fs.writeFile(path.join(current,'mine.txt'),'keep');
	await assert.rejects(ExecuteBackup(config,['one'],{dryRun:true}));assert.equal(await fs.readFile(path.join(current,'mine.txt'),'utf8'),'keep');
	await fs.rename(current,path.join(config.targets[0].path,'foreign'));
	await fs.writeFile(path.join(config.targets[0].path,'.microgulp-backup.lock'),'other process');
	await assert.rejects(ExecuteBackup(config,['one'],{dryRun:false}));assert.equal(await fs.readFile(path.join(config.targets[0].path,'.microgulp-backup.lock'),'utf8'),'other process');
});

test('corrupted ZIP and mismatched manifest are rejected',async _t=>{
	const config=await Fixture(_t,{mode:'snapshots',format:'zip'});
	const output=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json')));
	await assert.rejects(VerifyZip(path.join(output,'project.zip'),[{...manifest.files[0],sha256:'0'.repeat(64)}],10000));
	await fs.writeFile(path.join(output,'project.zip'),'broken');await assert.rejects(VerifyZip(path.join(output,'project.zip'),manifest.files,10000));
});

test('linked files in current prevent replacement and preserve outside data',async _t=>{
	const config=await Fixture(_t);
	const current=(await ExecuteBackup(config,['one'],{dryRun:false})).results[0].snapshot;
	const outside=path.join(path.dirname(config.source),'outside.txt');await fs.writeFile(outside,'untouched');
	await fs.link(outside,path.join(current,'data','outside-link.txt'));
	await assert.rejects(ExecuteBackup(config,['one'],{dryRun:false}),_error=>_error.report.results[0].errorCode==='UNSAFE_BACKUP_TREE');
	assert.equal(await fs.readFile(outside,'utf8'),'untouched');
	assert.equal(await fs.readFile(path.join(current,'data','Ä space.txt'),'utf8'),'version 1');
});
