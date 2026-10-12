import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngLength(bytes, offset = 0, expectedSize) {
  if (!bytes.subarray(offset, offset + 8).equals(signature)) throw new Error('Invalid PNG signature');
  let cursor = offset + 8;
  let chunks = 0;
  let hasImage = false;
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const end = cursor + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG');
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (crc32(bytes.subarray(cursor + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG CRC mismatch');
    if (chunks++ === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Invalid PNG header');
      if (expectedSize && (bytes.readUInt32BE(cursor + 8) !== expectedSize || bytes.readUInt32BE(cursor + 12) !== expectedSize)) throw new Error('Unexpected icon dimensions');
    }
    if (type === 'IDAT') hasImage = true;
    if (type === 'IEND') {
      if (length !== 0 || !hasImage) throw new Error('Invalid PNG end');
      return end - offset;
    }
    cursor = end;
  }
  throw new Error('Missing PNG end');
}

export function locateIcons(original, profile) {
  if (sha256(original) !== profile.sha256) throw new Error('Unsupported executable hash; no files changed');
  const slots = [];
  for (const slot of profile.slots) {
    const matches = [];
    for (let offset = original.indexOf(signature); offset !== -1; offset = original.indexOf(signature, offset + 8)) {
      if (sha256(original.subarray(offset, offset + slot.length)) === slot.sha256) {
        if (pngLength(original, offset, slot.size) !== slot.length) throw new Error('Original icon failed validation');
        matches.push(offset);
      }
    }
    if (matches.length !== 1) throw new Error(`Expected exactly one ${slot.size}px icon; found ${matches.length}`);
    const offset = matches[0];
    if (slots.some(other => offset < other.offset + other.length && other.offset < offset + slot.length)) throw new Error('Overlapping icon allocations');
    slots.push({ offset, length: slot.length, size: slot.size });
  }
  return slots;
}

export function patchImages(original, profile, replacements) {
  const slots = locateIcons(original, profile);
  const patched = Buffer.from(original);
  for (const slot of profile.slots) {
    const replacement = replacements.get(slot.size);
    if (!replacement || replacement.length !== slot.length || sha256(replacement) !== slot.replacementSha256 || pngLength(replacement, 0, slot.size) !== slot.length) throw new Error('Replacement artwork failed validation');
    replacement.copy(patched, slots.find(found => found.size === slot.size).offset);
  }
  return { patched, slots };
}
