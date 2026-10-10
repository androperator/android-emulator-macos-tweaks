import { readFile, writeFile, mkdir, realpath, lstat, readdir, rename, rm, open } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, patchImages } from './png.js';
import { macOS } from './platform.js';
import { addIconHelper } from './macho.js';
import { readRuntime, copyRuntime, verifyRuntime, runtimeHash } from './runtime.js';
import { readNamingBundle, configurationHash, verifyNaming, installConfiguration, removeConfiguration } from './names.js';
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
      if (!/^[a-f0-9]{64}(?:-(?:automatic|names)-[a-f0-9]{64})?$/.test(name)) continue;
      const receiptPath = join(folder, name, 'receipt.json');
      try {
        if (!(await lstat(receiptPath)).isFile()) throw new Error('Invalid backup receipt');
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        if (![1, 2, 3].includes(receipt.schema) || receipt.target !== target || receipt.originalHash !== name.slice(0, 64) || !/^[a-f0-9]{64}$/.test(receipt.patchedHash ?? '') || !['prepared','applied','restored'].includes(receipt.state)) throw new Error('Invalid backup receipt');
        if (receipt.schema === 1 && name !== receipt.originalHash) throw new Error('Invalid legacy backup directory');
        if (receipt.schema === 2 && (receipt.icons !== 'auto' || name !== `${receipt.originalHash}-automatic-${runtimeHash(receipt.runtime)}`)) throw new Error('Invalid automatic backup directory');
        if (receipt.schema === 3 && (name !== `${receipt.originalHash}-names-${receipt.namesHash}` || !['auto', 'phone'].includes(receipt.icons) || ![receipt.namesHash, receipt.backendHash, receipt.scriptHash, receipt.configHash].every(hash => /^[a-f0-9]{64}$/.test(hash ?? '')))) throw new Error('Invalid naming backup directory');
        if (receipt.schema === 3 && receipt.icons === 'auto') runtimeHash(receipt.runtime);
        receipts.push({ ...receipt, directory: join(folder, name) });
      } catch (error) {
        throw new Error(`Cannot read backup receipt ${receiptPath}: ${error.message}`);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const configHash = await configurationHash(target);
  const receipt = receipts.find(record => record.schema === 3 && record.configHash === configHash && [record.patchedHash, record.originalHash].includes(targetHash)) ?? receipts.find(record => record.patchedHash === targetHash) ?? receipts.find(record => record.originalHash === targetHash);
  const profile = profiles.find(item => item.revision === revision && item.sha256 === targetHash);
  const state = receipt?.patchedHash === targetHash ? 'patched' : profile ? 'original' : 'unsupported';
  let runtimeHealthy = null;
  if (receipt?.runtime && state === 'patched') {
    try { await verifyRuntime(join(receipt.directory, 'runtime'), receipt.runtime); runtimeHealthy = true; }
    catch { runtimeHealthy = false; }
  }
  const icons = state === 'patched' ? (receipt.icons ?? 'phone') : null;
  const names = state === 'patched' && receipt.schema === 3 ? 'avd' : 'off';
  let namingHealthy = null;
  if (names === 'avd') {
    try { await verifyNaming(receipt); namingHealthy = configHash === receipt.configHash; }
    catch { namingHealthy = false; }
  }
  return { configHash, names, namingHealthy, icons, runtimeHealthy, sdk, revision, target, targetHash, storage, folder, targetId, state, receipt, profile, adapter, mode: info.mode & 0o777, receipts };
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
  const names = options.names ?? 'avd';
  if (!['avd', 'off'].includes(names)) throw new Error('Expected --names avd or off');
  if (!['auto', 'phone'].includes(icons)) throw new Error('Expected --icons auto or phone');
  const context = await inspect(options);
  const runtimeDirectory = options.runtimeDir ?? join(packageRoot, 'assets/runtime');
  const originalHash = context.state === 'patched' ? context.receipt.originalHash : context.targetHash;
  const profile = (options.profiles ?? bundledProfiles).find(item => item.revision === context.revision && item.sha256 === originalHash);
  if (!profile) throw new Error(`Unsupported emulator ${context.revision ?? 'version'} (${context.targetHash}). No files changed. See supported builds in README.`);
  const bundle = icons === 'auto' ? await readRuntime(runtimeDirectory, context.adapter) : null;
  const naming = names === 'avd' ? await readNamingBundle(options.packageRoot ?? packageRoot, context.adapter, options.nodePath) : null;
  const namesHash = naming ? sha256(Buffer.from(JSON.stringify([naming.hash, icons, bundle?.hash ?? null]))) : null;
  const directory = join(context.folder, naming ? `${originalHash}-names-${namesHash}` : icons === 'auto' ? `${originalHash}-automatic-${bundle.hash}` : originalHash);
  return withLock(context, async () => {
    await context.adapter.verify(context.target);
    const activeConfig = await configurationHash(context.target);
    if (activeConfig && !context.receipts.some(record => record.schema === 3 && record.configHash === activeConfig)) throw new Error('Unrecognized naming configuration; nothing overwritten');
    const existing = context.receipts.find(record => record.directory === directory);
    if (existing) {
      if (await hashFile(join(directory, 'original')) !== originalHash) throw new Error('Original backup is corrupt; refusing to replace it');
      if (await hashFile(join(directory, 'patched')) !== existing.patchedHash) throw new Error('Patched backup is corrupt');
      if (existing.runtime) {
        await verifyRuntime(join(directory, 'runtime'), existing.runtime);
        await context.adapter.verify(join(directory, 'runtime/helper.dylib'));
      }
      if (existing.schema === 3) {
        await verifyNaming(existing);
        await context.adapter.verify(join(directory, 'backend'));
        await installConfiguration(context, existing);
      }
      if (context.targetHash === existing.patchedHash && (existing.schema !== 3 || activeConfig === existing.configHash)) return { ...context, changed: false };
      await replace(context, join(directory, 'patched'), existing.patchedHash);
      if (!naming) await removeConfiguration(context);
      await atomicJSON(join(directory, 'receipt.json'), { ...existing, directory: undefined, state: 'applied' });
      return { ...context, state: 'patched', icons, names, namingHealthy: naming ? true : null, runtimeHealthy: bundle ? true : null, changed: true, backup: directory };
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
    let namingFields = {};
    if (naming) {
      const backend = join(preparation, 'backend');
      await rename(candidate, backend);
      const backendHash = await hashFile(backend), scriptHash = sha256(naming.script);
      await writeFile(join(preparation, 'launch.mjs'), naming.script, { mode: 0o600 });
      const configuration = { schema: 1, sdk: context.sdk, target: context.target, directory, revision: context.revision, node: naming.node, script: join(directory, 'launch.mjs'), backend: join(directory, 'backend'), backendHash, scriptHash };
      await atomicJSON(join(preparation, 'launch.json'), configuration);
      namingFields = { namesHash, backendHash, scriptHash, configHash: await hashFile(join(preparation, 'launch.json')) };
      await context.adapter.copy(naming.launcher, candidate);
      await context.adapter.sign(backup, candidate, preparation);
    }
    const patchedHash = await hashFile(candidate);
    const receipt = { schema: naming ? 3 : bundle ? 2 : 1, target: context.target, revision: context.revision, build: profile.build, originalHash, patchedHash, state: 'prepared', created: new Date().toISOString(), slots, ...(bundle ? { icons, runtime: bundle.manifest } : {}), ...(naming ? { icons, ...namingFields } : {}) };
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
    if (naming) {
      const prepared = { ...receipt, directory };
      await verifyNaming(prepared);
      await installConfiguration(context, prepared);
    }
    await replace(context, join(directory, 'patched'), patchedHash);
    if (!naming) await removeConfiguration(context);
    await atomicJSON(join(directory, 'receipt.json'), { ...receipt, state: 'applied' });
    return { ...context, state: 'patched', icons, names, namingHealthy: naming ? true : null, runtimeHealthy: bundle ? true : null, changed: true, backup: directory };
  });
}

export async function restore(options = {}) {
  const context = await inspect(options);
  if (context.receipt?.originalHash === context.targetHash) {
    if (context.configHash) return withLock(context, async () => {
      await removeConfiguration(context);
      return { ...context, changed: false };
    });
    return { ...context, changed: false };
  }
  if (context.state !== 'patched') throw new Error('No matching applied backup for this executable. Refusing to overwrite an SDK update or unrecognized patch.');
  return withLock(context, async () => {
    const backup = join(context.receipt.directory, 'original');
    if (await hashFile(backup) !== context.receipt.originalHash) throw new Error('Original backup is corrupt; nothing restored');
    await replace(context, backup, context.receipt.originalHash);
    await removeConfiguration(context);
    await atomicJSON(join(context.receipt.directory, 'receipt.json'), { ...context.receipt, directory: undefined, state: 'restored' });
    return { ...context, state: 'original', icons: null, names: 'off', namingHealthy: null, runtimeHealthy: null, changed: true, backup: context.receipt.directory };
  });
}
