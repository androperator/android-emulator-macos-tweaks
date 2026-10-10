#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { apply, restore, inspect } from '../src/core.js';
const help = `Usage: androperator-emulator-icon <status|apply|restore> [--accept-adhoc-signing] [--sdk PATH] [--backup-dir PATH] [--json]

status   Detect the SDK, version, executable support and backup state.
apply    Back up and patch a supported emulator; requires --accept-adhoc-signing.
restore  Restore the exact original executable if the current patch matches.

SDK discovery: --sdk, ANDROID_HOME, ANDROID_SDK_ROOT, ~/Library/Android/sdk.
Backups: ~/Library/Application Support/emulator-icon-macos/backups.
Patching replaces Google's signature with a local ad-hoc signature while retaining
its entitlements and hardened runtime. No developer certificate or private key is
used. Gatekeeper may treat the patched emulator differently. Restore reinstates
the original executable and Google's signature.
Example: androperator-emulator-icon apply --accept-adhoc-signing
Restart emulators after apply or restore.
SDK updates may remove the patch; unsupported builds are never modified.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'accept-adhoc-signing': { type: 'boolean' }, sdk: { type: 'string' }, 'backup-dir': { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
  }});
  if (values.help || !positionals.length && !values.version) console.log(help);
  else if (values.version) console.log('0.1.0');
  else {
    if (positionals.length !== 1 || !['status', 'apply', 'restore'].includes(positionals[0])) throw new Error('Expected status, apply, or restore. Use --help.');
    const command = positionals[0];
    if (command === 'apply' && !values['accept-adhoc-signing']) {
      throw new Error("apply requires --accept-adhoc-signing. Applying this patch replaces Google's signature with a local ad-hoc signature while preserving its entitlements and hardened runtime. No developer certificate or private key is used. Gatekeeper may treat the patched emulator differently. Restore reinstates the original executable and Google's signature. No files changed.\nRun: androperator-emulator-icon apply --accept-adhoc-signing");
    }
    const result = await ({ status: inspect, apply, restore }[command])({ sdk: values.sdk, backupDir: values['backup-dir'] });
    const output = { command, sdk: result.sdk, revision: result.revision, state: result.state, changed: result.changed ?? false, executable: result.target, sha256: result.targetHash, backup: result.backup ?? result.receipt?.directory ?? null };
    // Refresh the reported hash after a successful mutation.
    if (result.changed) output.sha256 = (await inspect({ sdk: values.sdk, backupDir: values['backup-dir'] })).targetHash;
    console.log(values.json ? JSON.stringify(output, null, 2) : `${result.state}: Android Emulator ${result.revision}\n${result.target}${output.backup ? `\nBackup: ${output.backup}` : ''}${result.changed ? '\nRestart emulators to see the change.' : ''}`);
  }
} catch (error) { console.error(`androperator-emulator-icon: ${error.message}`); process.exitCode = 1; }
