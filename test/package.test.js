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
 const cli=fileURLToPath(new URL('../bin/emulator-icon.js',import.meta.url));
 assert.match(execFileSync(process.execPath,[cli,'--help'],{encoding:'utf8'}),/Usage: emulator-icon <status\|apply\|restore>/);
 assert.throws(()=>execFileSync(process.execPath,[cli,'erase'],{stdio:'pipe'}),error=>error.status===1 && /emulator-icon: Expected status/.test(error.stderr.toString()));
 assert.throws(()=>execFileSync(process.execPath,[cli,'apply','--force'],{stdio:'pipe'}),error=>error.status===1);
});

test('npm exposes emulator-icon while preserving the scoped package name',async()=>{
 const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 assert.equal(metadata.name,'@androperator/emulator-icon-macos');
 assert.deepEqual(metadata.bin,{'emulator-icon':'bin/emulator-icon.js'});
});
