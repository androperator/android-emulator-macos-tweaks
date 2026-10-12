#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { apply, restore, inspect } from '../src/core.js';
const help = `Usage: androperator-emulator-tweaks <status|apply|restore> [--accept-adhoc-signing] [--icons auto|phone] [--names avd|off] [--sdk PATH] [--backup-dir PATH] [--json]

status   Detect the SDK, version, executable support and backup state.
apply    Install per-device icons and AVD labels; requires --accept-adhoc-signing.
restore  Restore the exact original executable if the current patch matches.

SDK discovery: --sdk, ANDROID_HOME, ANDROID_SDK_ROOT, ~/Library/Android/sdk.
Backups: ~/Library/Application Support/emulator-icon-macos/backups.
Patching replaces Google's signature with a local ad-hoc signature while retaining
its entitlements and hardened runtime. No developer certificate or private key is
used. Gatekeeper may treat the patched emulator differently. Restore reinstates
the original executable and Google's signature.
Example: androperator-emulator-tweaks apply --accept-adhoc-signing
Icons: auto (default) selects phone, tablet, TV, watch or automotive from AVD metadata.
Use --icons phone with apply for the fixed phone icon. Names: avd (default) labels standard SDK launches, including ADBuddy. Use --names off for icons only.
Restart emulators after apply or restore.
SDK updates may remove the patch; unsupported builds are never modified.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'accept-adhoc-signing': { type: 'boolean' }, icons: { type: 'string' }, names: { type: 'string' }, sdk: { type: 'string' }, 'backup-dir': { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
  }});
  if (values.help || !positionals.length && !values.version) console.log(help);
  else if (values.version) console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  else {
    if (positionals.length !== 1 || !['status', 'apply', 'restore'].includes(positionals[0])) throw new Error('Expected status, apply, or restore. Use --help.');
    const command = positionals[0];
    if (values.icons && (command !== 'apply' || !['auto', 'phone'].includes(values.icons))) throw new Error('--icons auto|phone is only valid with apply');
    if (values.names && (command !== 'apply' || !['avd', 'off'].includes(values.names))) throw new Error('--names avd|off is only valid with apply');
    if (command === 'apply' && !values['accept-adhoc-signing']) {
      throw new Error("apply requires --accept-adhoc-signing. Applying this patch replaces Google's signature with a local ad-hoc signature while preserving its entitlements and hardened runtime. No developer certificate or private key is used. Gatekeeper may treat the patched emulator differently. Restore reinstates the original executable and Google's signature. No files changed.\nRun: androperator-emulator-tweaks apply --accept-adhoc-signing");
    }
    const result = await ({ status: inspect, apply, restore }[command])({ sdk: values.sdk, backupDir: values['backup-dir'], icons: values.icons, names: values.names });
    const output = { compatibilityReason: result.compatibilityReason, supportedVersions: result.supportedVersions, command, names: result.names, namingHealthy: result.namingHealthy, icons: result.icons, runtimeHealthy: result.runtimeHealthy, sdk: result.sdk, revision: result.revision, state: result.state, changed: result.changed ?? false, executable: result.target, sha256: result.targetHash, backup: result.backup ?? result.receipt?.directory ?? null };
    // Refresh the reported hash after a successful mutation.
    if (result.changed) output.sha256 = (await inspect({ sdk: values.sdk, backupDir: values['backup-dir'] })).targetHash;
    console.log(values.json ? JSON.stringify(output, null, 2) : `${result.state}${result.names === 'avd' ? ` (AVD names${result.namingHealthy === false ? ', naming runtime missing or corrupt; restore remains available' : ''})` : ''}${result.icons ? ` (${result.icons} icons${result.runtimeHealthy === false ? ', runtime missing or corrupt; restore remains available' : ''})` : ''}: Android Emulator ${result.revision}\n${result.target}${output.backup ? `\nBackup: ${output.backup}` : ''}${result.changed ? '\nRestart emulators to see the change.' : ''}`);
  }
} catch (error) { console.error(`androperator-emulator-tweaks: ${error.message}`); process.exitCode = 1; }
