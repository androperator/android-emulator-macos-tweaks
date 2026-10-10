import { readFile, mkdir, lstat, realpath, readdir, symlink, copyFile, chmod, mkdtemp, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function avdName(arguments_) {
  const names = [];
  for (let i = 0; i < arguments_.length; i++) {
    if (arguments_[i] === '-avd' && arguments_[i + 1]) names.push(arguments_[++i]);
    else if (arguments_[i].startsWith('@')) names.push(arguments_[i].slice(1));
  }
  if (new Set(names).size > 1) throw new Error('Conflicting AVD names');
  const name = names[0];
  if (name && (!/^[A-Za-z0-9_.-]{1,255}$/.test(name) || ['.', '..', 'qemu-system-aarch64'].includes(name.toLowerCase()))) throw new Error('Invalid or reserved AVD name');
  return arguments_.includes('-no-window') ? undefined : name;
}
async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${path}`);
  return info;
}
export async function prepareLaunch(config, arguments_) {
  if (config.schema !== 1 || await realpath(config.sdk) !== config.sdk || !config.directory.startsWith('/') ||
      config.target !== join(config.sdk, 'emulator/qemu/darwin-aarch64/qemu-system-aarch64') ||
      config.backend !== join(config.directory, 'backend') || config.script !== join(config.directory, 'launch.mjs')) throw new Error('Invalid naming configuration');
  const revision = (await readFile(join(config.sdk, 'emulator/source.properties'), 'utf8')).match(/^Pkg\.Revision\s*=\s*(\S+)\s*$/m)?.[1];
  if (revision !== config.revision) throw new Error('SDK version changed; restore or reapply emulator tweaks');
  await regularFile(config.backend);
  if (hash(await readFile(config.backend)) !== config.backendHash) throw new Error('Named emulator backend is corrupt');
  const name = avdName(arguments_) ?? 'qemu-system-aarch64';
  const launches = join(config.directory, 'launches');
  await mkdir(launches, { recursive: true, mode: 0o700 });
  const info = await lstat(launches);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid naming cache directory');
  const destination = join(launches, hash(Buffer.from(name)));
  const executable = join(destination, 'sdk/emulator/qemu/darwin-aarch64', name);
  try {
    await regularFile(executable);
    if (hash(await readFile(executable)) !== config.backendHash) throw new Error('Cached named emulator is corrupt');
    return executable;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await mkdtemp(join(launches, '.prepare-'));
  try {
    async function clone(from, to, relative = '') {
      await mkdir(to, { mode: 0o700 });
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        const source = join(from, entry.name), output = join(to, entry.name);
        if (['emulator', 'emulator/qemu', 'emulator/qemu/darwin-aarch64'].includes(key)) await clone(source, output, key);
        else if (key !== 'emulator/qemu/darwin-aarch64/qemu-system-aarch64' && entry.name !== '.emulator-tweaks-launch.json' && entry.name !== '.emulator-icon-macos.lock') await symlink(source, output);
      }
    }
    await clone(config.sdk, join(temporary, 'sdk'));
    const candidate = join(temporary, 'sdk/emulator/qemu/darwin-aarch64', name);
    // Never overwrite a library or other SDK entry that happens to share the AVD name.
    await copyFile(config.backend, candidate, constants.COPYFILE_EXCL);
    await chmod(candidate, (await regularFile(config.backend)).mode & 0o777);
    if (hash(await readFile(candidate)) !== config.backendHash) throw new Error('Named emulator copy changed');
    try { await rename(temporary, destination); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    await regularFile(executable);
    if (hash(await readFile(executable)) !== config.backendHash) throw new Error('Concurrent named emulator cache is corrupt');
    return executable;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(await prepareLaunch(config, process.argv.slice(3)));
  } catch (error) { console.error(`androperator-emulator-tweaks: ${error.message}`); process.exitCode = 1; }
}
