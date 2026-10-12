import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm, stat, lstat, realpath, cp } from 'node:fs/promises';
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
  return {names:'off',icons:'phone',sdk,assetsDir,backupDir,profiles,adapter,target,original};
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

async function automaticFixture(t) {
 const f = await fixture(t);
 const header = Buffer.alloc(4096);
 header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(0x100000c, 4); header.writeUInt32LE(2, 12);
 header.writeUInt32LE(1, 16); header.writeUInt32LE(152, 20);
 header.writeUInt32LE(0x19, 32); header.writeUInt32LE(152, 36); header.writeUInt32LE(1, 96);
 header.writeUInt32LE(4096, 152);
 f.original = Buffer.concat([header, png(0), Buffer.from('untouched suffix')]);
 await writeFile(f.target, f.original);
 f.profiles[0].sha256 = sha256(f.original);
 f.runtimeDir = join(f.backupDir, '..', 'runtime-source');
 await cp(new URL('../assets/runtime', import.meta.url), f.runtimeDir, { recursive: true });
 delete f.icons;
 return f;
}

test('automatic icons install an immutable runtime, restore exact bytes, and reapply safely', async t => {
 const f = await automaticFixture(t);
 const result = await apply(f);
 const patched = await readFile(f.target);
 const status = await inspect(f);
 assert.equal(status.icons, 'auto'); assert.equal(status.runtimeHealthy, true); assert.equal(status.receipt.schema, 2);
 assert.ok(patched.includes(Buffer.from(join(result.backup, 'runtime/helper.dylib'))));
 assert.deepEqual(await readFile(join(result.backup, 'original')), f.original);
 assert.equal((await apply(f)).changed, false);
 await restore(f); assert.deepEqual(await readFile(f.target), f.original);
 assert.equal((await stat(f.target)).mode & 0o777, 0o755);
 await apply(f); assert.deepEqual(await readFile(f.target), patched);
});

test('legacy phone patch upgrades to automatic icons without changing its original backup', async t => {
 const f = await automaticFixture(t);
 const legacy = await apply({ ...f, icons: 'phone' });
 const legacyReceipt = await readFile(join(legacy.backup, 'receipt.json'));
 const automatic = await apply(f);
 assert.notEqual(automatic.backup, legacy.backup);
 assert.deepEqual(await readFile(join(legacy.backup, 'receipt.json')), legacyReceipt);
 assert.deepEqual(await readFile(join(automatic.backup, 'original')), f.original);
 await apply({ ...f, icons: 'phone' }); assert.equal((await inspect(f)).icons, 'phone');
 await apply(f); await restore(f); assert.deepEqual(await readFile(f.target), f.original);
});

test('missing or corrupt installed runtime is visible and does not prevent exact restoration', async t => {
 for (const missing of [true, false]) {
  const f = await automaticFixture(t); const result = await apply(f);
  const helper = join(result.backup, 'runtime/helper.dylib');
  if (missing) await rm(helper); else await writeFile(helper, 'corrupt helper');
  assert.equal((await inspect(f)).runtimeHealthy, false);
  await assert.rejects(apply(f), /ENOENT|corrupt/);
  await restore(f); assert.deepEqual(await readFile(f.target), f.original);
 }
});

test('corrupt packaged runtime and malformed manifests leave the SDK unchanged', async t => {
 const f = await automaticFixture(t);
 await writeFile(join(f.runtimeDir, 'icons/watch.png'), 'corrupt');
 await assert.rejects(apply(f), /corrupt/); assert.deepEqual(await readFile(f.target), f.original);
 const path = join(f.runtimeDir, 'manifest.json'); const manifest = JSON.parse(await readFile(path));
 manifest.files['../escape'] = manifest.files['helper.dylib']; await writeFile(path, JSON.stringify(manifest));
 await assert.rejects(apply(f), /Invalid automatic/); assert.deepEqual(await readFile(f.target), f.original);
});

test('automatic signing failure and SDK updates preserve the original and installed state', async t => {
 const f = await automaticFixture(t); f.adapter.sign = async () => { throw new Error('signing failed'); };
 await assert.rejects(apply(f), /signing failed/); assert.deepEqual(await readFile(f.target), f.original);
 f.adapter.sign = async () => {}; const result = await apply(f); await writeFile(f.target, 'updated SDK');
 await assert.rejects(restore(f), /Refusing/); await assert.rejects(apply(f), /Unsupported/);
 assert.deepEqual(await readFile(join(result.backup, 'original')), f.original);
});

test('automatic prepared receipts recover after replacement interruption', async t => {
 const f = await automaticFixture(t); const verify = f.adapter.verify;
 f.adapter.verify = async file => { if (file.includes('.emulator-icon-')) throw new Error('interrupted'); };
 await assert.rejects(apply(f), /interrupted/); assert.deepEqual(await readFile(f.target), f.original);
 f.adapter.verify = verify; await apply(f); assert.equal((await inspect(f)).runtimeHealthy, true);
 await restore(f); assert.deepEqual(await readFile(f.target), f.original);
});

test('runtime upgrades create new generations without overwriting old runtime backups', async t => {
 const f = await automaticFixture(t); const first = await apply(f);
 const path = join(f.runtimeDir, 'helper.dylib'); await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('new build')]));
 const manifestPath = join(f.runtimeDir, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath));
 manifest.files['helper.dylib'] = sha256(await readFile(path)); await writeFile(manifestPath, JSON.stringify(manifest));
 const second = await apply(f); assert.notEqual(first.backup, second.backup);
 assert.notEqual(sha256(await readFile(join(first.backup, 'runtime/helper.dylib'))), manifest.files['helper.dylib']);
 await restore(f); assert.deepEqual(await readFile(f.target), f.original);
});

test('installed runtime symlinks are refused while restoration remains available', async t => {
 const { symlink } = await import('node:fs/promises');
 const f = await automaticFixture(t); const result = await apply(f);
 const path = join(result.backup, 'runtime/icons/watch.png'); await rm(path);
 await symlink(join(f.runtimeDir, 'icons/watch.png'), path);
 assert.equal((await inspect(f)).runtimeHealthy, false); await assert.rejects(apply(f), /Invalid automatic/);
 await restore(f); assert.deepEqual(await readFile(f.target), f.original);
});

test('AVD naming upgrades legacy backups, preserves originals and restores the standard backend', async t => {
 const f=await automaticFixture(t);
 const legacy=await apply(f);
 const oldReceipt=await readFile(join(legacy.backup,'receipt.json'));
 const named=await apply({...f,names:'avd'});
 const status=await inspect(f);
 assert.equal(status.names,'avd');assert.equal(status.namingHealthy,true);assert.equal(status.receipt.schema,3);
 assert.deepEqual(await readFile(join(legacy.backup,'receipt.json')),oldReceipt);
 assert.deepEqual(await readFile(join(named.backup,'original')),f.original);
 assert.equal((await apply({...f,names:'avd'})).changed,false);
 await restore(f);assert.deepEqual(await readFile(f.target),f.original);
 await assert.rejects(lstat(join(f.sdk,'emulator/qemu/darwin-aarch64/.emulator-tweaks-launch.json')),/ENOENT/);
 await apply({...f,names:'avd'});assert.equal((await inspect(f)).namingHealthy,true);
 await apply(f);assert.equal((await inspect(f)).names,'off');
 await assert.rejects(lstat(join(f.sdk,'emulator/qemu/darwin-aarch64/.emulator-tweaks-launch.json')),/ENOENT/);
 await restore(f);assert.deepEqual(await readFile(f.target),f.original);
});

test('missing naming script does not prevent exact restore, and foreign configuration is preserved',async t=>{
 const f=await automaticFixture(t);const named=await apply({...f,names:'avd'});
 await rm(join(named.backup,'launch.mjs'));
 assert.equal((await inspect(f)).namingHealthy,false);
 await assert.rejects(apply({...f,names:'avd'}),/ENOENT|corrupt/);
 await restore(f);assert.deepEqual(await readFile(f.target),f.original);
 const config=join(f.sdk,'emulator/qemu/darwin-aarch64/.emulator-tweaks-launch.json');
 await writeFile(config,'foreign configuration');
 await assert.rejects(apply({...f,names:'avd'}),/Unrecognized/);
 assert.equal(await readFile(config,'utf8'),'foreign configuration');
});

test('naming interruption recovers without losing the vendor backup or configuration ownership',async t=>{
 const f=await automaticFixture(t);const verify=f.adapter.verify;
 f.adapter.verify=async file=>{if(file.includes('.emulator-icon-'))throw new Error('interrupted');};
 await assert.rejects(apply({...f,names:'avd'}),/interrupted/);
 assert.deepEqual(await readFile(f.target),f.original);
 f.adapter.verify=verify;await apply({...f,names:'avd'});
 assert.equal((await inspect(f)).namingHealthy,true);
 await restore(f);assert.deepEqual(await readFile(f.target),f.original);
});

test('naming backend corruption and SDK updates are detected without overwriting installed files',async t=>{
 const f=await automaticFixture(t);const named=await apply({...f,names:'avd'});
 await writeFile(join(named.backup,'backend'),'corrupt');
 assert.equal((await inspect(f)).namingHealthy,false);
 await assert.rejects(apply({...f,names:'avd'}),/corrupt/);
 await restore(f);assert.deepEqual(await readFile(f.target),f.original);
 const other=await automaticFixture(t);const result=await apply({...other,names:'avd'});
 await writeFile(other.target,'SDK update');await assert.rejects(restore(other),/Refusing/);
 await assert.rejects(apply({...other,names:'avd'}),/Unsupported/);
 assert.deepEqual(await readFile(join(result.backup,'original')),other.original);
});


test('nearby and different minor versions accept changed binaries with verified icon structure', async t => {
 for (const revision of ['37.1.10', '37.2.1']) {
  const f = await automaticFixture(t);
  await writeFile(join(f.sdk, 'emulator/source.properties'), `Pkg.Revision=${revision}`);
  f.original = Buffer.concat([f.original, Buffer.from('different build')]);
  await writeFile(f.target, f.original);
  assert.equal((await inspect(f)).state, 'original');
  await apply({...f, names:'avd'});
  assert.equal((await inspect(f)).state, 'patched');
  assert.equal((await apply({...f, names:'avd'})).changed, false);
  await restore(f);
  assert.deepEqual(await readFile(f.target), f.original);
 }
});

test('structural compatibility rejects duplicate icons and invalid Mach-O before backup', async t => {
 for (const duplicate of [true, false]) {
  const f = await automaticFixture(t);
  await writeFile(join(f.sdk, 'emulator/source.properties'), 'Pkg.Revision=37.1.10');
  const bytes = duplicate ? Buffer.concat([f.original, png(0)]) : Buffer.from(f.original);
  if (!duplicate) bytes.writeUInt32LE(0, 0);
  await writeFile(f.target, bytes);
  const status = await inspect(f);
  assert.equal(status.state, 'unsupported');
  assert.match(status.compatibilityReason, duplicate ? /exactly one/ : /Mach-O/);
  await assert.rejects(apply(f), /Unsupported/);
  assert.deepEqual(await readFile(f.target), bytes);
  await assert.rejects(stat(f.backupDir), /ENOENT/);
 }
});
