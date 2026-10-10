import { readFile, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './png.js';
export const configurationPath = target => join(dirname(target), '.emulator-tweaks-launch.json');
export async function configurationHash(target) {
  try {
    const path = configurationPath(target), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Naming configuration must be a regular file');
    return sha256(await readFile(path));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function readNamingBundle(root, adapter, node = process.execPath) {
  const directory = join(root, 'assets/launcher');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const launcher = join(directory, 'launcher');
  const bytes = await readFile(launcher), script = await readFile(join(root, 'src/launch.mjs'));
  if (bytes.length < 16 || manifest.schema !== 1 || manifest.architecture !== 'arm64' || sha256(bytes) !== manifest.sha256 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x100000c || bytes.readUInt32LE(12) !== 2) throw new Error('Invalid bundled AVD launcher');
  await adapter.verify(launcher);
  return { launcher, script, node, hash: sha256(Buffer.from(JSON.stringify([manifest.sha256, sha256(script), node]))) };
}
export async function verifyNaming(receipt) {
  for (const [name, expected] of [['backend', receipt.backendHash], ['launch.mjs', receipt.scriptHash], ['launch.json', receipt.configHash]]) {
    const path = join(receipt.directory, name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || sha256(await readFile(path)) !== expected) throw new Error('Naming runtime is missing or corrupt');
  }
}
export async function installConfiguration(context, receipt) {
  const current = await configurationHash(context.target);
  if (current && !context.receipts.some(record => record.schema === 3 && record.configHash === current)) throw new Error('Unrecognized naming configuration; nothing overwritten');
  const temporary = `${configurationPath(context.target)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, await readFile(join(receipt.directory, 'launch.json')), { flag: 'wx', mode: 0o600 });
    await rename(temporary, configurationPath(context.target));
  } finally { await rm(temporary, { force: true }); }
}
export async function removeConfiguration(context) {
  const current = await configurationHash(context.target);
  if (current && context.receipts.some(record => record.schema === 3 && record.configHash === current)) await rm(configurationPath(context.target));
}
