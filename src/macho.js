// Only add a weak dependency in existing, zero-filled load-command padding.
// A missing helper does not prevent the emulator from starting.
export function addIconHelper(original, libraryPath) {
  if (original.length < 32 || original.readUInt32LE(0) !== 0xfeedfacf || original.readUInt32LE(4) !== 0x100000c || original.readUInt32LE(12) !== 2) throw new Error('Expected a thin arm64 Mach-O executable');
  if (!libraryPath.startsWith('/') || libraryPath.includes('\0')) throw new Error('Helper library path must be absolute');
  const count = original.readUInt32LE(16), commandBytes = original.readUInt32LE(20), end = 32 + commandBytes;
  if (end > original.length) throw new Error('Invalid Mach-O command table');
  let cursor = 32, firstData = original.length;
  for (let index = 0; index < count; index++) {
    if (cursor + 8 > end) throw new Error('Truncated load command');
    const command = original.readUInt32LE(cursor), size = original.readUInt32LE(cursor + 4);
    if (size < 8 || size % 8 || cursor + size > end) throw new Error('Invalid load command size');
    if ([0xc, 0x80000018].includes(command) && size >= 24) {
      const nameOffset = original.readUInt32LE(cursor + 8);
      if (nameOffset < 24 || nameOffset >= size) throw new Error('Invalid library load command');
      const name = original.subarray(cursor + nameOffset, cursor + size).toString('utf8').split('\0')[0];
      if (name === libraryPath) throw new Error('Helper dependency is already installed');
    }
    if (command === 0x19) {
      if (size < 72) throw new Error('Invalid segment command');
      const sections = original.readUInt32LE(cursor + 64);
      if (72 + sections * 80 > size) throw new Error('Invalid segment sections');
      for (let section = 0; section < sections; section++) {
        const offset = original.readUInt32LE(cursor + 72 + section * 80 + 48);
        if (offset) firstData = Math.min(firstData, offset);
      }
      const fileOffset = original.readBigUInt64LE(cursor + 40);
      if (fileOffset > 0n && fileOffset <= BigInt(original.length)) firstData = Math.min(firstData, Number(fileOffset));
    }
    cursor += size;
  }
  if (cursor !== end || firstData === original.length || firstData < end) throw new Error('Could not verify load-command padding');
  const name = Buffer.from(libraryPath + '\0');
  const size = Math.ceil((24 + name.length) / 8) * 8;
  if (end + size > firstData || original.subarray(end, end + size).some(byte => byte !== 0)) throw new Error('Insufficient zero-filled load-command padding');
  const patched = Buffer.from(original);
  patched.writeUInt32LE(0x80000018, end); // LC_LOAD_WEAK_DYLIB
  patched.writeUInt32LE(size, end + 4);
  patched.writeUInt32LE(24, end + 8);
  name.copy(patched, end + 24);
  patched.writeUInt32LE(count + 1, 16);
  patched.writeUInt32LE(commandBytes + size, 20);
  return patched;
}
