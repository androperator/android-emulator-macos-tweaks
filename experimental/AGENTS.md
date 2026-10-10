# Experimental tooling

Read [README.md](README.md) before changing this folder.

These tools explore per-device icons and AVD names in temporary SDK copies.
Automatic icons and AVD naming are supported in the main CLI; these older preview tools remain experimental.
These preview tools are excluded from the npm package and are separate from the supported
CLI in `../src/` and `../bin/`.

- Keep experiments confined to temporary copies. Do not install hooks or named
  launchers into the real SDK without explicit user authorization.
- Keep shared artwork in `../assets/`; keep bundled device variants in `../assets/runtime/` and render preview variants into the
  temporary output directory. Do not duplicate the packaged phone artwork here.
- Preserve `prototype.json` compatibility for existing temporary previews.
- Run `npm test` for imports, Mach-O checks and name validation. Run
  `node experimental/verify-native.mjs` for native changes; it requires Xcode
  and a graphical macOS session. State any checks that could not run.
- Process-name assertions do not prove a Dock or Cmd-Tab label. Verify visible
  behavior separately before claiming those labels work.
- Move features into the supported CLI only with version detection, signing
  consent, backups, restoration, and documented compatibility.
