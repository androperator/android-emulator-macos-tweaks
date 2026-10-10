# Automatic device icon prototype

This experiment chooses a Dock icon separately for each emulator process. It
supports phone, tablet, TV, watch and automotive artwork, and offers named preview launchers for Dock and task-switcher label experiments. It is separate from
the stable CLI and is not included in the npm package.

## Try it without modifying your installed SDK

Requires Apple Silicon macOS, Xcode, Node.js 22 or newer, and the currently
supported emulator build. The source executable may be Google's original or a
verified patch managed by the stable CLI.

```sh
node prototype/prepare.mjs --accept-adhoc-signing
```

The command prints a temporary directory and `launcher` path. It copies the
launcher and GUI executable, links the original SDK's libraries and system
images, builds a native helper and renders artwork with Apple's asset compiler.
Only the temporary GUI executable receives a startup hook and local ad-hoc
signature. The installed SDK, its signature and existing backups are unchanged.
No developer certificate or private key is used.

Use the printed launcher path to start existing AVDs:

```sh
"/printed/temporary/path/sdk/emulator/emulator" -avd Pixel_9 -read-only -no-snapshot
"/printed/temporary/path/sdk/emulator/emulator" -avd Androperator_Wear_API_35 -read-only -no-snapshot
```

Use different AVDs, or assign distinct even `-port` values if necessary.
`-read-only -no-snapshot` keeps these experiments from saving guest changes to
the original AVD. Do not point Android Studio at this temporary SDK or use it
for SDK maintenance: libraries and system images are links to the installed SDK.

The temporary directory includes `original`, the exact executable copied before
adding the startup hook, and `prototype.json` with the relevant paths and hashes.
To undo the experiment, close its emulator instances and remove only the printed
temporary directory. Your installed emulator does not need restoration.

## How selection works

The temporary GUI executable has a weak Mach-O dependency on the helper library.
The patch uses verified, zero-filled header padding; executable sections keep
their original positions. If the helper is absent, the weak dependency lets the
emulator start with its ordinary icon.

Inside each GUI process, the helper reads `-avd NAME` or `@NAME`
and resolves the AVD's `config.ini`. It checks `ANDROID_AVD_HOME`,
`ANDROID_EMULATOR_HOME/avd`, and `ANDROID_USER_HOME/avd` (default `~/.android/avd`),
including `.ini` pointers to custom AVD locations. A valid `path.rel` relative to
the parent of the AVD home takes precedence over `path`. `-datadir` changes guest
data storage, so it does not override the named AVD metadata.

Wear, TV and automotive image tags take precedence. Known tablet profile names
and a minimum configured screen width of 600 density-independent pixels identify
tablets. Known foldable names keep the phone icon. Unknown or missing metadata
falls back to phone; missing artwork preserves the emulator's supplied icon.
This is a heuristic for the initial configuration, not a live reaction to device
rotation or folding. Custom devices may need explicit classification in a future
version.

The helper intercepts AppKit's application-icon setter, so subsequent Qt icon
updates keep the selected device icon. Selection happens independently in each
process. No background service, polling, launch wrapper environment variable or
personal signing key is required after the startup hook is present.

For Dock and task-switcher labels, create a separate preview launcher for each AVD:

```sh
node prototype/launch-preview.mjs /printed/temporary/path Pixel_9
```

Use its printed launcher with the same AVD name and `-read-only -no-snapshot`.
This copies the patched backend to an executable literally named `Pixel_9` and
places a small native forwarding executable at the launcher's usual backend path.
The forwarding executable preserves the standard launcher's arguments and full
environment. Directly launching the renamed backend without that environment can
fail to load its graphics libraries. The named copy retains the original patched
bytes and signature. Close the preview and remove its printed temporary directory
to undo it; keep its base prototype while using the named launcher.

The previous private LaunchServices display-name update changed the process record
but did not change the actual Dock tooltip or task-switcher label. It has been
removed. Metadata checks alone do not establish either visible label; verify those
surfaces when testing a named preview. A global per-device naming mechanism for
ordinary installed-SDK launches has not been implemented.

The supported emulator already permits local library loading through its
entitlements. Signing preserves those entitlements. The temporary executable is
no longer Google-signed or notarized; Gatekeeper behavior may differ. No security
settings are changed.

## Validation and limits

```sh
npm test
node prototype/verify-native.mjs
```

The normal tests verify safe Mach-O edits and refusal of malformed tables or
occupied padding. The explicit native check requires Xcode and a macOS graphical
session. It compiles an AppKit probe and checks actual icon pixels across parallel
processes for all five device types, missing metadata, foldables, custom AVD
pointers and `-datadir`. It also checks the macOS application display name and verifies fallback when
artwork is absent.

Phone and Wear OS AVDs have booted simultaneously through a temporary SDK copy.
Tablet, TV and automotive selection has passed the AppKit probe, but those guest
systems have not all been boot-tested. Android Studio launches and its embedded
emulator mode have not been tested. Normal standalone launches from a SDK with
this hook should load the helper, but installation into the real SDK is a separate
step requiring explicit approval and a production backup/restore design.

The helper path is absolute and belongs to the temporary directory. Keep that
directory while using its launcher. Do not distribute this temporary executable,
move it into your real SDK or use the stable CLI to manage it. Xcode is needed to
build the prototype; the stable package continues to require no Xcode.
