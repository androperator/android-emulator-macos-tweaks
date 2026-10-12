# Changelog

## 1.0.3

- Accept compatible Apple Silicon Android Emulator 37.x builds by validating executable structure and embedded icon allocations instead of requiring an exact revision and whole-executable hash. Preserve exact backups, signing checks and SDK-update protection.
- Include supported version families and compatibility failure reasons in status JSON.

## 1.0.2

- Apply AVD Dock and Cmd-Tab labels to standard SDK launches by default, with `--names off` for icons only. Preserve launch arguments and environment, legacy backups, exact restore and safe per-AVD caches.

## 1.0.1

- Read the CLI version from package metadata so version output stays synchronized.
- Add repository, homepage and issue links to the npm package metadata.
- Add validated GitHub Trusted Publishing, release documentation and an agent release skill for future releases.

## 1.0.0

- Support automatic per-AVD phone, tablet, TV, watch and automotive icons by default, with a bundled native helper and `--icons phone` fallback mode. Preserve legacy backups, add runtime generations and health reporting, and keep AVD naming experimental.

- Require `--accept-adhoc-signing` for apply and explain the signing and Gatekeeper tradeoff before changing files.

- Rename the repository to `android-emulator-macos-tweaks`, package to `@androperator/emulator-macos-tweaks`, and command to `androperator-emulator-tweaks`. Backup paths and SDK lock names remain unchanged for compatibility.

- Add SDK discovery, status, apply, and restore commands.
- Support Android Emulator 37.1.11 build 15917651 on Apple Silicon.
- Use native macOS icon artwork with content-verified PNG replacements.
- Preserve originals, signing entitlements, receipts, and atomic restoration.
- Refuse unsupported binaries, SDK updates, corrupt backups, and concurrent mutations.
