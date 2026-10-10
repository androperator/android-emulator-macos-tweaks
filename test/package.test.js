import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, pngLength } from '../src/png.js';
test('every bundled icon has its profiled hash, dimensions and allocation length',async()=>{
 const profiles=JSON.parse(await readFile(new URL('../src/profiles.json',import.meta.url)));
 for(const profile of profiles)for(const slot of profile.slots){const bytes=await readFile(new URL(`../assets/${slot.size}.png`,import.meta.url));assert.equal(sha256(bytes),slot.replacementSha256);assert.equal(pngLength(bytes,0,slot.size),slot.length);assert.equal(bytes.length,slot.length);}
});
test('CLI help is usable and invalid commands fail',()=>{
 const cli=fileURLToPath(new URL('../bin/androperator-emulator-icon.js',import.meta.url));
 assert.match(execFileSync(process.execPath,[cli,'--help'],{encoding:'utf8'}),/Usage: androperator-emulator-icon <status\|apply\|restore>/);
 assert.throws(()=>execFileSync(process.execPath,[cli,'erase'],{stdio:'pipe'}),error=>error.status===1 && /androperator-emulator-icon: Expected status/.test(error.stderr.toString()));
 assert.throws(()=>execFileSync(process.execPath,[cli,'apply','--force'],{stdio:'pipe'}),error=>error.status===1);
});

test('npm exposes androperator-emulator-icon while preserving the scoped package name',async()=>{
 const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 assert.equal(metadata.name,'@androperator/emulator-icon-macos');
 assert.deepEqual(metadata.bin,{'androperator-emulator-icon':'bin/androperator-emulator-icon.js'});
});

test('apply requires explicit signing acceptance before inspecting or modifying the SDK',async t=>{
 const { mkdtemp, mkdir, writeFile, rm, access } = await import('node:fs/promises');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'emulator-icon-consent-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const sdk=join(root,'sdk');const directory=join(sdk,'emulator/qemu/darwin-aarch64');
 await mkdir(directory,{recursive:true});
 const binary=join(directory,'qemu-system-aarch64');await writeFile(binary,'unchanged executable');
 await writeFile(join(sdk,'emulator/source.properties'),'Pkg.Revision=99.0.0');
 const backup=join(root,'backups');
 const cli=fileURLToPath(new URL('../bin/androperator-emulator-icon.js',import.meta.url));
 const args=['apply','--sdk',sdk,'--backup-dir',backup];
 for(const extra of [[],['--json']]){
  assert.throws(()=>execFileSync(process.execPath,[cli,...args,...extra],{stdio:'pipe'}),error=>{
   const message=error.stderr.toString();
   assert.equal(error.status,1);
   for(const text of ['--accept-adhoc-signing',"Google's signature",'local ad-hoc signature','No developer certificate or private key','Gatekeeper',"Restore reinstates the original executable and Google's signature",'No files changed'])assert.ok(message.includes(text),text);
   return true;
  });
 }
 assert.equal(await readFile(binary,'utf8'),'unchanged executable');
 await assert.rejects(access(backup));
 await assert.rejects(access(join(directory,'.emulator-icon-macos.lock')));
 // With acceptance, apply reaches compatibility checks rather than stopping at the gate.
 assert.throws(()=>execFileSync(process.execPath,[cli,...args,'--accept-adhoc-signing'],{stdio:'pipe'}),error=>error.status===1 && /Unsupported emulator/.test(error.stderr.toString()));
 const status=JSON.parse(execFileSync(process.execPath,[cli,'status','--sdk',sdk,'--backup-dir',backup,'--json'],{encoding:'utf8'}));
 assert.equal(status.state,'unsupported');
 assert.throws(()=>execFileSync(process.execPath,[cli,'restore','--sdk',sdk,'--backup-dir',backup],{stdio:'pipe'}),error=>error.status===1 && /No matching applied backup/.test(error.stderr.toString()) && !/requires --accept-adhoc-signing/.test(error.stderr.toString()));
});

test('help and no-argument usage explain the signing acceptance flag',()=>{
 const cli=fileURLToPath(new URL('../bin/androperator-emulator-icon.js',import.meta.url));
 for(const args of [[],['--help']]){
  const output=execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
  assert.match(output,/apply.*requires --accept-adhoc-signing/);
  assert.match(output,/No developer certificate or private key/);
  assert.match(output,/Gatekeeper/);
 }
});
