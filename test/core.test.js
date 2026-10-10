import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { apply, restore, inspect, discoverSDK } from '../src/core.js';
import { sha256, patchImages, pngLength } from '../src/png.js';
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size=Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const checksum=Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size,payload,checksum]);
}
function png(color) {
  const header=Buffer.alloc(13); header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(32*(32*4+1),color);
  for(let i=0;i<32;i++) rows[i*129]=0;
  const raw=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
  return Buffer.concat([raw.subarray(0,-12),chunk('npAD',Buffer.alloc(512-raw.length-12)),raw.subarray(-12)]);
}
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'emulator-icon-test-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const sdk=join(root,'sdk'); const assetsDir=join(root,'assets');const backupDir=join(root,'backups');
  const directory=join(sdk,'emulator/qemu/darwin-aarch64');await mkdir(directory,{recursive:true});await mkdir(assetsDir);
  await writeFile(join(sdk,'emulator/source.properties'),'Pkg.Revision = 37.1.11\n');
  const originalPNG=png(0);const replacementPNG=png(255);
  const original=Buffer.concat([Buffer.from('test executable prefix'),originalPNG,Buffer.from('untouched suffix')]);
  const target=join(directory,'qemu-system-aarch64');await writeFile(target,original,{mode:0o755});await writeFile(join(assetsDir,'32.png'),replacementPNG);
  const profiles=[{revision:'37.1.11',build:'fixture',binary:'qemu/darwin-aarch64/qemu-system-aarch64',sha256:sha256(original),slots:[{size:32,length:512,sha256:sha256(originalPNG),replacementSha256:sha256(replacementPNG)}]}];
  const adapter={platform:'darwin',copy:async(a,b)=>{await copyFile(a,b);await chmod(b,(await stat(a)).mode & 0o777);},verify:async()=>{},sign:async()=>{}};
  return {sdk,assetsDir,backupDir,profiles,adapter,target,original};
}

test('apply, idempotence, restore and reapply preserve exact original bytes and mode',async t=>{
 const f=await fixture(t);assert.equal((await inspect(f)).state,'original');
 const first=await apply(f);assert.equal(first.changed,true);const patched=await readFile(f.target);assert.notDeepEqual(patched,f.original);
 assert.deepEqual(await readFile(join(first.backup,'original')),f.original);
 assert.equal((await stat(f.target)).mode & 0o777,0o755);
 assert.equal((await apply(f)).changed,false);
 assert.equal((await restore(f)).changed,true);assert.deepEqual(await readFile(f.target),f.original);
 assert.equal((await restore(f)).changed,false);await apply(f);assert.deepEqual(await readFile(f.target),patched);
});
test('unknown build and changed executable are refused without creating backups',async t=>{
 const f=await fixture(t);await writeFile(f.target,'new SDK executable');
 await assert.rejects(apply(f),/Unsupported/);await assert.rejects(restore(f),/Refusing/);assert.equal(await readFile(f.target,'utf8'),'new SDK executable');
});
test('restore refuses SDK updates and preserves backups',async t=>{
 const f=await fixture(t);const result=await apply(f);await writeFile(f.target,'SDK update');
 await assert.rejects(restore(f),/Refusing/);assert.deepEqual(await readFile(join(result.backup,'original')),f.original);
});
test('corrupt backups are never restored',async t=>{
 const f=await fixture(t);const result=await apply(f);const patched=await readFile(f.target);await writeFile(join(result.backup,'original'),'corrupt');
 await assert.rejects(restore(f),/corrupt/);assert.deepEqual(await readFile(f.target),patched);
});
test('signing failure leaves the installed binary untouched',async t=>{
 const f=await fixture(t);f.adapter.sign=async()=>{throw new Error('signing failed');};await assert.rejects(apply(f),/signing failed/);assert.deepEqual(await readFile(f.target),f.original);
});
test('SDK mutation during signing is not overwritten',async t=>{
 const f=await fixture(t);f.adapter.sign=async()=>writeFile(f.target,'concurrent SDK update');await assert.rejects(apply(f),/SDK changed/);assert.equal(await readFile(f.target,'utf8'),'concurrent SDK update');
});
test('a prepared receipt can recover after interrupted replacement',async t=>{
 const f=await fixture(t);let checks=0;f.adapter.verify=async()=>{if(++checks===2)throw new Error('interrupted');};await assert.rejects(apply(f),/interrupted/);
 assert.deepEqual(await readFile(f.target),f.original);f.adapter.verify=async()=>{};await apply(f);assert.equal((await inspect(f)).state,'patched');await restore(f);assert.deepEqual(await readFile(f.target),f.original);
});
test('concurrent and stale locks refuse mutation',async t=>{
 const f=await fixture(t);await mkdir(join(f.sdk,'emulator/qemu/darwin-aarch64/.emulator-icon-macos.lock'));
 await assert.rejects(apply(f),/holds/);assert.deepEqual(await readFile(f.target),f.original);
});
test('artwork corruption and duplicate images fail validation',async t=>{
 const f=await fixture(t);await writeFile(join(f.assetsDir,'32.png'),'bad');await assert.rejects(apply(f),/artwork/);assert.deepEqual(await readFile(f.target),f.original);
 const repeated=Buffer.concat([f.original,f.original]);const profile={...f.profiles[0],sha256:sha256(repeated)};
 assert.throws(()=>patchImages(repeated,profile,new Map([[32,png(255)]])),/exactly one/);
});
test('PNG chunk integrity and dimensions are checked',()=>{
 const bytes=png(0);assert.equal(pngLength(bytes,0,32),512);assert.throws(()=>pngLength(bytes,0,128),/dimensions/);bytes[24]^=1;assert.throws(()=>pngLength(bytes),/CRC/);
});
test('SDK discovery respects explicit path then environment precedence',async t=>{
 const f=await fixture(t);const second=join(f.sdk,'other');await mkdir(join(second,'emulator'),{recursive:true});await writeFile(join(second,'emulator/source.properties'),'Pkg.Revision=1');
 assert.equal(await discoverSDK(f.sdk,{ANDROID_HOME:second}),f.sdk);
 assert.equal(await discoverSDK(undefined,{ANDROID_HOME:second,ANDROID_SDK_ROOT:f.sdk}),second);
 assert.equal(await discoverSDK(undefined,{ANDROID_HOME:'/missing',ANDROID_SDK_ROOT:f.sdk}),f.sdk);
 await assert.rejects(discoverSDK('/missing',{ANDROID_HOME:f.sdk}),/not found/);
});
test('version metadata must match the supported binary',async t=>{
 const f=await fixture(t);await writeFile(join(f.sdk,'emulator/source.properties'),'Pkg.Revision=99.0.0');await assert.rejects(apply(f),/Unsupported/);assert.deepEqual(await readFile(f.target),f.original);
});
test('unsupported Intel binaries can still be inspected',async t=>{
 const f=await fixture(t);await rm(f.target);const intel=join(f.sdk,'emulator/qemu/darwin-x86_64');await mkdir(intel);await writeFile(join(intel,'qemu-system-x86_64'),'Intel binary');assert.equal((await inspect(f)).state,'unsupported');await assert.rejects(apply(f),/Unsupported/);
});
test('backup receipts cannot point at a different SDK',async t=>{
 const f=await fixture(t);const result=await apply(f);const path=join(result.backup,'receipt.json');const receipt=JSON.parse(await readFile(path));receipt.target='/other/sdk/binary';await writeFile(path,JSON.stringify(receipt));await assert.rejects(restore(f),/Invalid backup receipt/);
});
