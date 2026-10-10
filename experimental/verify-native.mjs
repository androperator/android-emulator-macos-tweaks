import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { run } from '../src/platform.js';
import { generateIcons } from './generate-icons.mjs';
const execute = promisify(execFile);
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'emulator-icon-native-tests-'));
try {
  const helper = join(root, 'emulator-icon-helper.dylib'), probe = join(root, 'probe');
  await run('/usr/bin/xcrun', ['clang', '-dynamiclib', '-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-mmacosx-version-min=14.0', join(sourceRoot, 'experimental/icon-hook.m'), '-o', helper]);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', helper]);
  await run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-framework', 'AppKit', join(sourceRoot, 'experimental/probe.m'), '-o', probe]);
  await generateIcons(sourceRoot, root);
  const avdHome = join(root, 'avd'); await mkdir(avdHome);
  const fixtures = [
    ['phone', 'phone', 'hw.device.name=pixel_8_pro\nhw.lcd.width=1344\nhw.lcd.height=2992\nhw.lcd.density=480'],
    ['watch', 'watch', 'tag.id=android-wear\nhw.device.name=wearos_small_round'],
    ['tv', 'tv', 'tag.id=android-tv\nhw.lcd.width=1920\nhw.lcd.height=1080\nhw.lcd.density=160'],
    ['tablet', 'tablet', 'hw.device.name=pixel_tablet'],
    ['large', 'tablet', 'hw.lcd.width=1600\nhw.lcd.height=2560\nhw.lcd.density=320'],
    ['fold', 'phone', 'hw.device.name=pixel_10_pro_fold\nhw.lcd.width=2076\nhw.lcd.height=2152\nhw.lcd.density=390'],
    ['car', 'automotive', 'tag.id=android-automotive\nhw.lcd.width=1920\nhw.lcd.height=1080\nhw.lcd.density=160'],
    ['unknown', 'phone', 'hw.device.name=unknown'],
    ['pointer', 'tv', 'tag.id=android-tv']
  ];
  for (const [name, , config] of fixtures) {
    const directory = join(avdHome, name === 'pointer' ? 'custom location.avd' : `${name}.avd`);
    await mkdir(directory); await writeFile(join(directory, 'config.ini'), config + '\n');
    if (name === 'pointer') await writeFile(join(avdHome, 'pointer.ini'), `path=${directory}\n`);
  }
  const relocated = join(avdHome, 'relocated.avd'); await mkdir(relocated);
  await writeFile(join(relocated, 'config.ini'), 'tag.id=android-wear\n');
  await writeFile(join(avdHome, 'relocated.ini'), `path=${join(root, 'missing-old-location')}\npath.rel=avd/relocated.avd\n`);
  await writeFile(join(avdHome, 'prefer-relative.ini'), `path=${join(avdHome, 'tv.avd')}\npath.rel=avd/relocated.avd\n`);
  await writeFile(join(avdHome, 'absolute-fallback.ini'), `path=${join(avdHome, 'tv.avd')}\npath.rel=avd/missing-location.avd\n`);
  const environment = { ...process.env, ANDROID_AVD_HOME: avdHome, ANDROID_USER_HOME: join(root, 'unrelated-user-home'), ANDROID_EMULATOR_HOME: root, DYLD_INSERT_LIBRARIES: helper };
  const cases = fixtures.map(([name, variant]) => [name, variant, ['-avd', name]]);
  cases.push(
    ['at-name', 'watch', ['@watch']],
    ['data-directory', 'watch', ['-avd', 'watch', '-datadir', join(avdHome, 'tv.avd')]],
    ['empty-data-directory', 'watch', ['-avd', 'watch', '-datadir', join(root, 'empty-data')]],
    ['data-without-avd', 'phone', ['-datadir', join(avdHome, 'tv.avd')]],
    ['relative-custom-home', 'watch', ['-avd', 'relocated']],
    ['relative-before-absolute', 'watch', ['-avd', 'prefer-relative']],
    ['absolute-fallback', 'tv', ['-avd', 'absolute-fallback']],
    ['missing', 'phone', []],
    ['invalid-name', 'phone', ['-avd', '../invalid']]
  );
  const namedDirectory = join(root, 'named'); await mkdir(namedDirectory);
  const names = new Set(cases.map(([, , args]) => {
    const index = args.indexOf('-avd');
    const name = index >= 0 ? args[index + 1] : args[0]?.startsWith('@') ? args[0].slice(1) : 'probe';
    return name.includes('/') ? 'probe' : name;
  }));
  for (const name of names) await cp(probe, join(namedDirectory, name));
  await Promise.all(cases.map(async ([name, variant, args]) => {
    const namedIndex = args.indexOf('-avd');
    const expectedName = namedIndex >= 0 ? args[namedIndex + 1] : args[0]?.startsWith('@') ? args[0].slice(1) : null;
    const naming = { EMULATOR_ICON_EXPECTED_NAME: expectedName && !expectedName.includes('/') ? expectedName : 'probe' };
    const { stderr } = await execute(join(namedDirectory, naming.EMULATOR_ICON_EXPECTED_NAME), args, { env: { ...environment, ...naming, EMULATOR_ICON_EXPECTED: join(root, 'icons', `${variant}.png`) }, timeout: 30000 });
    assert.ok(stderr.includes(`variant=${variant} `), `${name}: ${stderr}`);
    assert.ok(stderr.includes('application icon matches expected variant'), name);
    console.log(`${name}: ${variant}, AppKit pixels and application name verified`);
  }));
  const wrapper = join(namedDirectory, 'wrapper');
  await run('/usr/bin/xcrun', ['clang', '-arch', 'arm64', '-DAVD_NAME="watch"', join(sourceRoot, 'experimental/launch-wrapper.c'), '-o', wrapper]);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', wrapper]);
  const wrapperEnvironment = { ...environment, EMULATOR_ICON_EXPECTED_NAME: 'watch', EMULATOR_ICON_EXPECTED: join(root, 'icons/watch.png') };
  await execute(wrapper, ['-avd', 'watch'], { env: wrapperEnvironment, timeout: 30000 });
  for (const args of [['-avd', 'phone'], ['@phone']]) await assert.rejects(execute(wrapper, args, { env: wrapperEnvironment }), error => error.code === 1 && error.stderr.includes('This preview launcher is for watch'));
  console.log('native forwarding launcher: arguments, environment and name verified');
  // Missing artwork must preserve the caller's icon instead of crashing.
  await rm(join(root, 'icons/watch.png'));
  await execute(probe, ['-avd', 'watch'], { env: { ...environment, EMULATOR_ICON_FALLBACK: '1' }, timeout: 30000 });
  console.log('missing artwork: caller icon preserved');
} finally { await rm(root, { recursive: true, force: true }); }
