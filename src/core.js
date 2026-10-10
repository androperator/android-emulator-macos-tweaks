import { readFile, writeFile, mkdir, realpath, lstat, readdir, rename, rm, open } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, patchImages } from './png.js';
import { macOS } from './platform.js';
import { addIconHelper } from './macho.js';
import { readRuntime, copyRuntime, verifyRuntime, runtimeHash } from './runtime.js';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const bundledProfiles = JSON.parse(await readFile(new URL('./profiles.json', import.meta.url)));
const hashFile = async file => sha256(await readFile(file));

async function atomicJSON(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
}

export async function discoverSDK(explicit, environment = process.env, home = homedir()) {
  const candidates = explicit ? [explicit] : [environment.ANDROID_HOME, environment.ANDROID_SDK_ROOT, join(home, 'Library/Android/sdk')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const sdk = await realpath(resolve(candidate));
      if ((await lstat(join(sdk, 'emulator/source.properties'))).isFile()) return sdk;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error('Android SDK not found. Pass --sdk /path/to/sdk.');
}

export async function inspect({ sdk: explicit, backupDir, profiles = bundledProfiles, adapter = macOS } = {}) {
  const sdk = await discoverSDK(explicit);
  const properties = await readFile(join(sdk, 'emulator/source.properties'), 'utf8');
  const revision = properties.match(/^Pkg\.Revision\s*=\s*(\S+)\s*$/m)?.[1];
  const supportedProfile = profiles.find(profile => profile.revision === revision);
  // Inspect only known GUI binary paths. Do not execute unknown emulator builds.
  let entry = join(sdk, 'emulator', supportedProfile?.binary ?? 'qemu/darwin-aarch64/qemu-system-aarch64');
  let info;
  try { info = await lstat(entry); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entry = join(sdk, 'emulator/qemu/darwin-x86_64/qemu-system-x86_64');
    info = await lstat(entry);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Emulator executable must be a regular file, not a symlink');
  const target = await realpath(entry);
  if (!target.startsWith(`${sdk}/emulator/`)) throw new Error('Emulator executable resolves outside the SDK');
  const targetHash = await hashFile(target);
  const storage = resolve(backupDir ?? join(homedir(), 'Library/Application Support/emulator-icon-macos/backups'));
  const targetId = sha256(Buffer.from(target));
  const folder = join(storage, targetId);
  let receipts = [];
  try {
    for (const name of await readdir(folder)) {
      if (!/^[a-f0-9]{64}(?:-automatic-[a-f0-9]{64})?$/.test(name)) continue;
      const receiptPath = join(folder, name, 'receipt.json');
      try {
        if (!(await lstat(receiptPath)).isFile()) throw new Error('Invalid backup receipt');
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        if (![1, 2].includes(receipt.schema) || receipt.target !== target || receipt.originalHash !== name.slice(0, 64) || !/^[a-f0-9]{64}$/.test(receipt.patchedHash ?? '') || !['prepared','applied','restored'].includes(receipt.state)) throw new Error('Invalid backup receipt');
        if (receipt.schema === 1 && name !== receipt.originalHash) throw new Error('Invalid legacy backup directory');
        if (receipt.schema === 2 && (receipt.icons !== 'auto' || name !== `${receipt.originalHash}-automatic-${runtimeHash(receipt.runtime)}`)) throw new Error('Invalid automatic backup directory');
        receipts.push({ ...receipt, directory: join(folder, name) });
      } catch (error) {
        throw new Error(`Cannot read backup receipt ${receiptPath}: ${error.message}`);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const receipt = receipts.find(record => record.patchedHash === targetHash) ?? receipts.find(record => record.originalHash === targetHash);
  const profile = profiles.find(item => item.revision === revision && item.sha256 === targetHash);
  const state = receipt?.patchedHash === targetHash ? 'patched' : profile ? 'original' : 'unsupported';
  let runtimeHealthy = null;
  if (receipt?.schema === 2 && state === 'patched') {
    try { await verifyRuntime(join(receipt.directory, 'runtime'), receipt.runtime); runtimeHealthy = true; }
    catch { runtimeHealthy = false; }
  }
  const icons = state === 'patched' ? (receipt.schema === 2 ? 'auto' : 'phone') : null;
  return { icons, runtimeHealthy, sdk, revision, target, targetHash, storage, folder, targetId, state, receipt, profile, adapter, mode: info.mode & 0o777, receipts };
}

async function withLock(context, operation) {
  if (context.adapter.platform !== 'darwin') throw new Error('Apply and restore require macOS');
  const lock = join(dirname(context.target), '.emulator-icon-macos.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another operation or interrupted run holds ${lock}. Inspect it before removing the lock.`);
    throw error;
  }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    if (await hashFile(context.target) !== context.targetHash) throw new Error('Emulator changed after inspection; no files replaced');
    return await operation();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function replace(context, source, expectedHash) {
  // Stage on the target filesystem and rename. Running processes retain the old inode.
  const staged = join(dirname(context.target), `.emulator-icon-${randomUUID()}`);
  try {
    await context.adapter.copy(source, staged);
    if (await hashFile(staged) !== expectedHash) throw new Error('Staged executable hash mismatch');
    await context.adapter.verify(staged);
    const handle = await open(staged, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    if (await hashFile(context.target) !== context.targetHash) throw new Error('SDK changed during operation; refusing to overwrite');
    await rename(staged, context.target);
  } finally { await rm(staged, { force: true }); }
}

export async function apply(options = {}) {
  const icons = options.icons ?? 'auto';
  if (!['auto', 'phone'].includes(icons)) throw new Error('Expected --icons auto or phone');
  const context = await inspect(options);
  const runtimeDirectory = options.runtimeDir ?? join(packageRoot, 'assets/runtime');
  const originalHash = context.state === 'patched' ? context.receipt.originalHash : context.targetHash;
  const profile = (options.profiles ?? bundledProfiles).find(item => item.revision === context.revision && item.sha256 === originalHash);
  if (!profile) throw new Error(`Unsupported emulator ${context.revision ?? 'version'} (${context.targetHash}). No files changed. See supported builds in README.`);
  const bundle = icons === 'auto' ? await readRuntime(runtimeDirectory, context.adapter) : null;
  const directory = join(context.folder, icons === 'auto' ? `${originalHash}-automatic-${bundle.hash}` : originalHash);
  return withLock(context, async () => {
    await context.adapter.verify(context.target);
    const existing = context.receipts.find(record => record.directory === directory);
    if (existing) {
      if (await hashFile(join(directory, 'original')) !== originalHash) throw new Error('Original backup is corrupt; refusing to replace it');
      if (await hashFile(join(directory, 'patched')) !== existing.patchedHash) throw new Error('Patched backup is corrupt');
      if (existing.schema === 2) {
        await verifyRuntime(join(directory, 'runtime'), existing.runtime);
        await context.adapter.verify(join(directory, 'runtime/helper.dylib'));
      }
      if (context.targetHash === existing.patchedHash) return { ...context, changed: false };
      await replace(context, join(directory, 'patched'), existing.patchedHash);
      await atomicJSON(join(directory, 'receipt.json'), { ...existing, directory: undefined, state: 'applied' });
      return { ...context, state: 'patched', icons, runtimeHealthy: bundle ? true : null, changed: true, backup: directory };
    }
    // Always derive a new patch from the verified original, including legacy upgrades.
    const originalSource = context.state === 'patched' ? join(context.receipt.directory, 'original') : context.target;
    if (await hashFile(originalSource) !== originalHash) throw new Error('Original backup is corrupt');
    await context.adapter.verify(originalSource);
    const original = await readFile(originalSource);
    const replacements = new Map();
    for (const slot of profile.slots) replacements.set(slot.size, await readFile(join(options.assetsDir ?? join(packageRoot, 'assets'), `${slot.size}.png`)));
    const { patched, slots } = patchImages(original, profile, replacements);
    await mkdir(context.folder, { recursive: true, mode: 0o700 });
    const preparation = join(context.folder, `.prepare-${randomUUID()}`);
    await mkdir(preparation, { mode: 0o700 });
    const backup = join(preparation, 'original');
    const candidate = join(preparation, 'patched');
    await context.adapter.copy(originalSource, backup);
    if (await hashFile(backup) !== originalHash) throw new Error('Original backup hash mismatch');
    await context.adapter.copy(backup, candidate);
    if (bundle) await copyRuntime(runtimeDirectory, join(preparation, 'runtime'), bundle.manifest);
    await writeFile(candidate, bundle ? addIconHelper(patched, join(directory, 'runtime/helper.dylib')) : patched);
    await context.adapter.sign(backup, candidate, preparation);
    const patchedHash = await hashFile(candidate);
    const receipt = { schema: bundle ? 2 : 1, target: context.target, revision: context.revision, build: profile.build, originalHash, patchedHash, state: 'prepared', created: new Date().toISOString(), slots, ...(bundle ? { icons, runtime: bundle.manifest } : {}) };
    for (const file of [backup, candidate]) {
      const handle = await open(file, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    }
    await atomicJSON(join(preparation, 'receipt.json'), receipt);
    await rename(preparation, directory);
    if (bundle) {
      await verifyRuntime(join(directory, 'runtime'), bundle.manifest);
      await context.adapter.verify(join(directory, 'runtime/helper.dylib'));
    }
    await replace(context, join(directory, 'patched'), patchedHash);
    await atomicJSON(join(directory, 'receipt.json'), { ...receipt, state: 'applied' });
    return { ...context, state: 'patched', icons, runtimeHealthy: bundle ? true : null, changed: true, backup: directory };
  });
}

export async function restore(options = {}) {
  const context = await inspect(options);
  if (context.receipt?.originalHash === context.targetHash) return { ...context, changed: false };
  if (context.state !== 'patched') throw new Error('No matching applied backup for this executable. Refusing to overwrite an SDK update or unrecognized patch.');
  return withLock(context, async () => {
    const backup = join(context.receipt.directory, 'original');
    if (await hashFile(backup) !== context.receipt.originalHash) throw new Error('Original backup is corrupt; nothing restored');
    await replace(context, backup, context.receipt.originalHash);
    await atomicJSON(join(context.receipt.directory, 'receipt.json'), { ...context.receipt, directory: undefined, state: 'restored' });
    return { ...context, state: 'original', icons: null, runtimeHealthy: null, changed: true, backup: context.receipt.directory };
  });
}
