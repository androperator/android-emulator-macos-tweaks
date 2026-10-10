#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, symlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inspect } from '../src/core.js';
import { sha256 } from '../src/png.js';
import { macOS, run } from '../src/platform.js';
import { generateIcons } from './generate-icons.mjs';
import { addIconHelper } from './macho.mjs';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = `Prototype automatic device icons in a temporary SDK copy.
Usage: node prototype/prepare.mjs --accept-adhoc-signing [--sdk PATH]
Requires Apple Silicon macOS, Xcode, and a supported original or CLI-managed emulator.
Only the temporary executable is modified and signed locally; no developer key is used.
The installed SDK and its existing backups are unchanged. Gatekeeper behavior may differ.
`;
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage); return; }
  let accepted = false, sdk;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--accept-adhoc-signing') accepted = true;
    else if (arg === '--sdk' && args[0] && !args[0].startsWith('--')) sdk = args.shift();
    else throw new Error(`Invalid argument ${arg}\n${usage}`);
  }
  if (!accepted) throw new Error(`--accept-adhoc-signing is required. No files changed.\n${usage}`);
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Requires Apple Silicon macOS');
  const context = await inspect({ sdk });
  const profiles = JSON.parse(await readFile(join(sourceRoot, 'src/profiles.json')));
  let vendorHash = context.targetHash;
  if (context.state === 'patched' && context.receipt) {
    vendorHash = sha256(await readFile(join(context.receipt.directory, 'original')));
    if (vendorHash !== context.receipt.originalHash) throw new Error('Original backup is corrupt');
  }
  if (!profiles.some(profile => profile.sha256 === vendorHash && profile.revision === context.revision)) throw new Error('Unsupported emulator; nothing changed');
  await macOS.verify(context.target);
  const root = await mkdtemp(join(tmpdir(), 'emulator-icon-automatic-'));
  const sdkCopy = join(root, 'sdk');
  await mkdir(sdkCopy);
  // Copy executable directories; link large read-only libraries and system images.
  async function copyTree(from, to, relative = '') {
    await mkdir(to);
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const original = join(from, entry.name), output = join(to, entry.name);
      if (['emulator', 'emulator/qemu', 'emulator/qemu/darwin-aarch64'].includes(name) && entry.isDirectory()) await copyTree(original, output, name);
      else if (['emulator/emulator', 'emulator/qemu/darwin-aarch64/qemu-system-aarch64'].includes(name)) await macOS.copy(original, output);
      else await symlink(original, output);
    }
  }
  // sdkCopy exists already, so populate its entries explicitly.
  for (const entry of await readdir(context.sdk, { withFileTypes: true })) {
    if (entry.name === 'emulator') await copyTree(join(context.sdk, entry.name), join(sdkCopy, entry.name), 'emulator');
    else await symlink(join(context.sdk, entry.name), join(sdkCopy, entry.name));
  }
  const target = join(sdkCopy, 'emulator/qemu/darwin-aarch64/qemu-system-aarch64');
  const original = join(root, 'original');
  await macOS.copy(target, original);
  if (sha256(await readFile(original)) !== context.targetHash) throw new Error('Emulator changed while preparing copy');
  const helper = join(root, 'emulator-icon-helper.dylib');
  await run('/usr/bin/xcrun', ['clang', '-arch', 'arm64', '-dynamiclib', '-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-mmacosx-version-min=14.0', join(sourceRoot, 'prototype/icon-hook.m'), '-o', helper]);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', helper]);
  await macOS.verify(helper);
  await generateIcons(sourceRoot, root);
  await writeFile(target, addIconHelper(await readFile(original), helper));
  await macOS.sign(original, target, root);
  if (sha256(await readFile(context.target)) !== context.targetHash) throw new Error('Installed SDK changed externally during preparation');
  const result = { root, launcher: join(sdkCopy, 'emulator/emulator'), executable: target, helper, originalHash: context.targetHash, patchedHash: sha256(await readFile(target)), installedSDKUnchanged: true };
  await writeFile(join(root, 'prototype.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(`emulator-icon prototype: ${error.message}`); process.exitCode = 1; });
