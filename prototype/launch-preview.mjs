#!/usr/bin/env node
import { readdir, mkdir, symlink, readFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, macOS } from '../src/platform.js';
import { sha256 } from '../src/png.js';
export function validateAVDName(name) {
  if (!/^[A-Za-z0-9_.-]{1,255}$/.test(name ?? '') || ['.', '..', 'qemu-system-aarch64'].includes(name?.toLowerCase())) throw new Error('Expected a valid AVD name');
}
export async function createNamedPreview(rootPath, name) {
  validateAVDName(name);
  const root = await realpath(rootPath);
  const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
  if (await realpath(manifest.root) !== root) throw new Error('Prototype manifest root mismatch');
  const source = join(root, 'sdk');
  const original = join(source, 'emulator/qemu/darwin-aarch64/qemu-system-aarch64');
  if (sha256(await readFile(original)) !== manifest.patchedHash) throw new Error('Prototype executable changed; prepare a fresh copy');
  await macOS.verify(original);
  const destination = await mkdtemp(join(tmpdir(), 'emulator-icon-named-'));
  const sdk = join(destination, 'sdk');
  async function copyTree(from, to, relative = '') {
    await mkdir(to);
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      const input = join(from, entry.name), output = join(to, entry.name);
      if (relative === 'emulator/qemu/darwin-aarch64' && entry.name.toLowerCase() === name.toLowerCase()) continue;
      if (['emulator', 'emulator/qemu', 'emulator/qemu/darwin-aarch64'].includes(key)) await copyTree(input, output, key);
      else if (key === 'emulator/emulator') await macOS.copy(input, output);
      else if (key === 'emulator/qemu/darwin-aarch64/qemu-system-aarch64') {
        const named = join(to, name);
        await macOS.copy(input, named);
        if (sha256(await readFile(named)) !== manifest.patchedHash) throw new Error('Named executable copy mismatch');
        await macOS.verify(named);
        await run('/usr/bin/xcrun', ['clang', '-arch', 'arm64', `-DAVD_NAME="${name}"`, fileURLToPath(new URL('./launch-wrapper.c', import.meta.url)), '-o', output]);
        await run('/usr/bin/codesign', ['--force', '--sign', '-', output]);
        await macOS.verify(output);
      } else await symlink(input, output);
    }
  }
  await copyTree(source, sdk);
  return { root: destination, avd: name, launcher: join(sdk, 'emulator/emulator'), executable: join(sdk, 'emulator/qemu/darwin-aarch64', name), basePrototype: root };
}
async function main() {
  const [root, name, ...extra] = process.argv.slice(2);
  if (!root || !name || extra.length) throw new Error('Usage: node prototype/launch-preview.mjs PREPARED_ROOT AVD_NAME\nPrints a per-AVD temporary launcher; it does not start the emulator or change your installed SDK.');
  console.log(JSON.stringify(await createNamedPreview(root, name), null, 2));
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
