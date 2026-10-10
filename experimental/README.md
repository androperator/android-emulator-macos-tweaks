# Experimental AVD Dock names

Automatic per-device icons are supported by the main CLI. This folder contains
per-AVD named preview launchers, which remain excluded from the npm package.
The phone preview's actual Dock tooltip has been confirmed as `Pixel_9`;
Cmd-Tab labels still need direct visual verification.

## Try a named preview

Requires Apple Silicon macOS, Xcode, Node.js 22 or newer, and the supported
emulator build. These commands leave the installed SDK and its backups unchanged.

```sh
node experimental/prepare.mjs --accept-adhoc-signing
node experimental/launch-preview.mjs /printed/temporary/path Pixel_9
```

The first command builds a temporary SDK copy from the verified original
executable, even if the installed executable has a CLI-managed patch. It links
SDK libraries and system images, builds the supported native helper and renders
preview artwork. Its temporary GUI executable receives a weak helper dependency
and a local ad-hoc signature with the original entitlements. No personal signing
key or security-setting changes are involved; Gatekeeper behavior may differ.

The second command prints a separate launcher for the named AVD. Use it with
the same name:

```sh
"/printed/named/launcher/path" -avd Pixel_9 -read-only -no-snapshot
```

Assign distinct even `-port` values when needed. `-read-only -no-snapshot` avoids
saving guest changes to the original AVD. Do not point Android Studio or SDK
maintenance tools at these temporary copies, whose libraries and images link
to the installed SDK.

The named launcher copies the backend under the literal AVD name, and installs
a small forwarding executable at the frontend's expected backend path. It keeps
the standard launcher's arguments and graphics environment. Direct backend
launches without that environment can fail. Reserved backend names, including
case-insensitive aliases, are refused.

The previous private LaunchServices rename changed a process record but did not
change the Dock or task-switcher label. It has been removed. Process metadata
checks alone do not establish either visible label. Global AVD naming for
ordinary installed-SDK launches has not been implemented; Android Studio
embedded mode has not been tested.

Keep both printed temporary directories while using the named launcher. Close
the previews and remove those directories to undo them. Do not move these
executables into the real SDK or use the main CLI to manage the preview patch.

## Contents and verification

- `prepare.mjs` builds an isolated SDK for naming experiments.
- `launch-preview.mjs` and `launch-wrapper.c` create per-AVD named launchers.
- `verify-native.mjs` checks native icon/name metadata and argument forwarding.

The supported icon implementation lives in `../native/icon-hook.m` and
`../src/macho.js`. Shared artwork and its editable phone source live in
[`../assets/`](../assets/), with bundled device artwork in `../assets/runtime/`.
`../scripts/generate-icons.mjs` renders preview artwork into temporary output.
Native probes share `../native/probe.m`.

```sh
npm test
node experimental/verify-native.mjs
```

Native checks require Xcode and a graphical macOS session. Temporary manifests
retain the name `prototype.json` so existing preview folders remain usable.
