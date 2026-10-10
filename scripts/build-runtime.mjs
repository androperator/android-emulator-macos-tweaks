#!/usr/bin/env node
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/platform.js';
import { sha256 } from '../src/png.js';
import { generateIcons } from './generate-icons.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'assets/runtime');
await mkdir(output, { recursive: true });
await run('/usr/bin/xcrun', ['clang', '-arch', 'arm64', '-dynamiclib', '-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-mmacosx-version-min=14.0', join(root, 'native/icon-hook.m'), '-o', join(output, 'helper.dylib')]);
await run('/usr/bin/codesign', ['--force', '--sign', '-', join(output, 'helper.dylib')]);
await generateIcons(root, output);
await rm(join(output, 'render'), { recursive: true, force: true });
const files = {};
for (const file of ['helper.dylib', ...['phone', 'tablet', 'tv', 'watch', 'automotive'].map(name => `icons/${name}.png`)]) files[file] = sha256(await readFile(join(output, file)));
await writeFile(join(output, 'manifest.json'), JSON.stringify({ schema: 1, architecture: 'arm64', files }, null, 2) + '\n');
console.log('Built packaged arm64 runtime and five device icons');
