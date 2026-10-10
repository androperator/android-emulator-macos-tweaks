import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  await run('/usr/bin/xcrun', ['clang', '-dynamiclib', '-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-mmacosx-version-min=14.0', join(sourceRoot, 'prototype/icon-hook.m'), '-o', helper]);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', helper]);
  await run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-framework', 'AppKit', join(sourceRoot, 'prototype/probe.m'), '-o', probe]);
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
    ['missing', 'phone', []]
  );
  await Promise.all(cases.map(async ([name, variant, args]) => {
    const { stderr } = await execute(probe, args, { env: { ...environment, EMULATOR_ICON_EXPECTED: join(root, 'icons', `${variant}.png`) }, timeout: 30000 });
    assert.ok(stderr.includes(`variant=${variant} `), `${name}: ${stderr}`);
    assert.ok(stderr.includes('application icon matches expected variant'), name);
    console.log(`${name}: ${variant}, AppKit pixels verified`);
  }));
  // Missing artwork must preserve the caller's icon instead of crashing.
  await rm(join(root, 'icons/watch.png'));
  await execute(probe, ['-avd', 'watch'], { env: { ...environment, EMULATOR_ICON_FALLBACK: '1' }, timeout: 30000 });
  console.log('missing artwork: caller icon preserved');
} finally { await rm(root, { recursive: true, force: true }); }
