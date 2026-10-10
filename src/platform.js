import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const execute = promisify(execFile);
export async function run(executable, args) {
  try {
    return await execute(executable, args, { timeout: 60000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`${executable.split('/').at(-1)} failed: ${(error.stderr || error.message).trim()}`);
  }
}
export const macOS = {
  platform: process.platform,
  copy: (from, to) => run('/usr/bin/ditto', [from, to]),
  verify: file => run('/usr/bin/codesign', ['--verify', '--strict', file]),
  async sign(original, candidate, folder) {
    const { stdout } = await run('/usr/bin/codesign', ['-d', '--entitlements', ':-', original]);
    if (!stdout.trim().startsWith('<?xml') || !stdout.includes('<plist')) throw new Error('Could not extract original entitlements');
    const entitlements = `${folder}/entitlements.plist`;
    await writeFile(entitlements, stdout, { mode: 0o600 });
    await run('/usr/bin/plutil', ['-lint', entitlements]);
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--identifier', 'qemu-system-aarch64', '--entitlements', entitlements, candidate]);
    const result = await run('/usr/bin/codesign', ['-d', '--entitlements', ':-', candidate]);
    if (result.stdout.trim() !== stdout.trim()) throw new Error('Signing changed the original entitlements');
    await macOS.verify(candidate);
  }
};
