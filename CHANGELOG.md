# Changelog

## 1.0.0

- Support automatic per-AVD phone, tablet, TV, watch and automotive icons by default, with a bundled native helper and `--icons phone` fallback mode. Preserve legacy backups, add runtime generations and health reporting, and keep AVD naming experimental.

- Require `--accept-adhoc-signing` for apply and explain the signing and Gatekeeper tradeoff before changing files.

- Rename the repository to `android-emulator-macos-tweaks`, package to `@androperator/emulator-macos-tweaks`, and command to `androperator-emulator-tweaks`. Backup paths and SDK lock names remain unchanged for compatibility.

- Add SDK discovery, status, apply, and restore commands.
- Support Android Emulator 37.1.11 build 15917651 on Apple Silicon.
- Use native macOS icon artwork with content-verified PNG replacements.
- Preserve originals, signing entitlements, receipts, and atomic restoration.
- Refuse unsupported binaries, SDK updates, corrupt backups, and concurrent mutations.
