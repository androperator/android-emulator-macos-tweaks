import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRuntime, runtimeFiles } from '../src/runtime.js';
import { macOS } from '../src/platform.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = resolve(process.argv[2] || join(tmpdir(), `emulator-macos-tweaks-${metadata.version}.tgz`));
assert.equal(process.platform, 'darwin', 'Release validation requires macOS');
assert.match(metadata.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected stable X.Y.Z version');
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${metadata.version}`, 'Release tag must match package version');
const temporary = await mkdtemp(join(tmpdir(), 'emulator-tweaks-pack-'));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
try {
  execFileSync('npm', ['test'], { cwd: root, stdio: 'inherit', timeout: 120000 });
  const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]));
  const expected = [
    'LICENSE', 'NOTICE.md', 'README.md', 'package.json', 'bin/androperator-emulator-tweaks.js',
    ...['core.js', 'macho.js', 'platform.js', 'png.js', 'profiles.json', 'runtime.js'].map(name => `src/${name}`),
    ...['32.png', '128.png', '256.png', 'Emulator.icon/icon.json', 'Emulator.icon/Assets/emulator-symbol.svg'].map(name => `assets/${name}`),
    'assets/runtime/manifest.json', ...runtimeFiles.map(name => `assets/runtime/${name}`)
  ];
  assert.deepEqual(packed.files.map(file => file.path).sort(), expected.sort(), 'Unexpected package contents');
  const archive = join(temporary, packed.filename);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], consumer);
  const installed = join(consumer, 'node_modules/@androperator/emulator-macos-tweaks');
  const installedMetadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.name, '@androperator/emulator-macos-tweaks');
  assert.equal(installedMetadata.version, metadata.version);
  assert.equal(installedMetadata.license, 'Apache-2.0');
  assert.equal(installedMetadata.repository.url, 'git+https://github.com/androperator/android-emulator-macos-tweaks.git');
  const cli = join(consumer, 'node_modules/.bin/androperator-emulator-tweaks');
  assert.equal(run(cli, ['--version'], consumer).trim(), metadata.version);
  for (const args of [[], ['--help']]) assert.match(run(cli, args, consumer), /Usage: androperator-emulator-tweaks/);
  await readRuntime(join(installed, 'assets/runtime'), macOS);
  const sdk = join(temporary, 'sdk');
  const emulator = join(sdk, 'emulator');
  await mkdir(join(emulator, 'qemu/darwin-aarch64'), { recursive: true });
  await writeFile(join(emulator, 'source.properties'), 'Pkg.Revision=99.0.0\n');
  await writeFile(join(emulator, 'qemu/darwin-aarch64/qemu-system-aarch64'), 'unsupported synthetic executable');
  const status = JSON.parse(run(cli, ['status', '--sdk', sdk, '--backup-dir', join(temporary, 'backups'), '--json'], consumer));
  assert.equal(status.state, 'unsupported');
  assert.equal(status.changed, false);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(archive, output);
  console.log(`Validated ${metadata.name}@${metadata.version}: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
