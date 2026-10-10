import { readFile, lstat, realpath, mkdir, copyFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, pngLength } from './png.js';
export const runtimeFiles = ['helper.dylib', ...['phone', 'tablet', 'tv', 'watch', 'automotive'].map(name => `icons/${name}.png`)];
export function validateRuntimeManifest(manifest) {
  if (manifest?.schema !== 1 || manifest.architecture !== 'arm64' || !manifest.files || Object.keys(manifest.files).length !== runtimeFiles.length || runtimeFiles.some(file => !/^[a-f0-9]{64}$/.test(manifest.files[file] ?? ''))) throw new Error('Invalid automatic icon runtime manifest');
}
export function runtimeHash(manifest) {
  validateRuntimeManifest(manifest);
  return sha256(Buffer.from(JSON.stringify(runtimeFiles.map(file => [file, manifest.files[file]]))));
}
export async function verifyRuntime(directory, manifest) {
  validateRuntimeManifest(manifest);
  const root = await realpath(directory);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Automatic icon runtime must be a regular directory');
  for (const file of runtimeFiles) {
    const path = join(directory, file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || !(await realpath(path)).startsWith(`${root}/`)) throw new Error(`Invalid automatic icon runtime file: ${file}`);
    const bytes = await readFile(path);
    if (sha256(bytes) !== manifest.files[file]) throw new Error(`Automatic icon runtime is missing or corrupt: ${file}`);
    if (file.endsWith('.png')) pngLength(bytes, 0, 256);
    else if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x100000c || bytes.readUInt32LE(12) !== 6) throw new Error('Automatic icon helper must be a thin arm64 Mach-O library');
  }
}
export async function readRuntime(directory, adapter) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  await verifyRuntime(directory, manifest);
  await adapter.verify(join(directory, 'helper.dylib'));
  return { manifest, hash: runtimeHash(manifest) };
}
export async function copyRuntime(source, destination, manifest) {
  await mkdir(destination);
  await mkdir(join(destination, 'icons'));
  for (const file of runtimeFiles) {
    const target = join(destination, file);
    await copyFile(join(source, file), target);
    const handle = await open(target, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  await verifyRuntime(destination, manifest);
}
