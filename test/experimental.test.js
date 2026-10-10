import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addIconHelper } from '../src/macho.js';
function executable() {
  const bytes = Buffer.alloc(1024);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(152, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(152, 36);
  bytes.writeUInt32LE(1, 96);
  bytes.writeUInt32LE(512, 152);
  bytes.fill(0xa5, 512);
  return bytes;
}
test('experimental patcher adds a weak helper dependency without moving sections or changing other bytes', () => {
  const before = executable();
  const after = addIconHelper(before, '/tmp/device icon/helper.dylib');
  assert.equal(after.length, before.length);
  assert.equal(after.readUInt32LE(16), 2);
  assert.equal(after.readUInt32LE(184), 0x80000018);
  assert.equal(after.readUInt32LE(192), 24);
  assert.equal(after.subarray(208).toString().split('\0')[0], '/tmp/device icon/helper.dylib');
  assert.deepEqual(after.subarray(32, 184), before.subarray(32, 184));
  assert.deepEqual(after.subarray(184 + after.readUInt32LE(188)), before.subarray(184 + after.readUInt32LE(188)));
  assert.throws(() => addIconHelper(after, '/tmp/device icon/helper.dylib'), /already installed/);
});
test('experimental patcher refuses invalid architecture, malformed tables, relative paths and occupied padding', () => {
  assert.throws(() => addIconHelper(Buffer.alloc(16), '/tmp/helper'), /Mach-O/);
  assert.throws(() => addIconHelper(executable(), 'helper'), /absolute/);
  assert.throws(() => addIconHelper(executable(), '/tmp/he\0lper'), /absolute/);
  const occupied = executable(); occupied[184] = 1;
  assert.throws(() => addIconHelper(occupied, '/tmp/helper'), /padding/);
  const tight = executable(); tight.writeUInt32LE(192, 152);
  assert.throws(() => addIconHelper(tight, '/tmp/helper'), /padding/);
  const corrupt = executable(); corrupt.writeUInt32LE(160, 36);
  assert.throws(() => addIconHelper(corrupt, '/tmp/helper'), /size/);
  const wrongSections = executable(); wrongSections.writeUInt32LE(2, 96);
  assert.throws(() => addIconHelper(wrongSections, '/tmp/helper'), /sections/);
});

// Named preview executables must stay within the temporary backend directory.
test('preview AVD names cannot introduce paths or invalid executable names', async () => {
  const { validateAVDName } = await import('../experimental/launch-preview.mjs');
  for (const name of ['Pixel_9', 'EmulatorIcon_Tablet_Preview', 'watch-1.0']) validateAVDName(name);
  for (const name of ['', '.', '..', 'qemu-system-aarch64', 'QEMU-system-aarch64', 'QEMU-SYSTEM-AARCH64', '../phone', 'phone/device', 'phone with spaces', 'a'.repeat(256)]) assert.throws(() => validateAVDName(name), /valid AVD/);
});
