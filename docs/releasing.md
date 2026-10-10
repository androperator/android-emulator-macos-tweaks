# Releasing emulator macOS tweaks

The npm package is `@androperator/emulator-macos-tweaks`; the command is
`androperator-emulator-tweaks`. Version `1.0.0` was published manually. Future
releases use GitHub Trusted Publishing through
[the release skill](../.agents/skills/release-package/SKILL.md).

## One-time npm setup

After the publishing workflow is merged into main, configure the package's
Trusted Publisher settings on npm:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Label | GitHub releases (optional) |
| Organization or user | `androperator` |
| Repository | `android-emulator-macos-tweaks` |
| Workflow filename | `publish-npm.yml` |
| Environment name | Leave blank |
| Allow npm publish | Enabled |
| Allow npm dist-tag | Disabled |

The workflow has no GitHub environment. Do not enter an environment name unless
both the workflow and npm configuration are changed together. No `NPM_TOKEN`
secret is used. npm supports OIDC on GitHub-hosted runners with npm 11.5.1+;
see [npm's Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).
Configuration is only verified after a future release successfully publishes
using OIDC. Do not dispatch publication for the already published `v1.0.0`.

## Release preparation

Create a release branch from main. Update `package.json` with
`npm version <X.Y.Z> --no-git-tag-version` and add its CHANGELOG entry. On macOS:

```sh
RELEASE_TAG=v<X.Y.Z> npm run release:pack -- /tmp/emulator-macos-tweaks-release.tgz
```

Replace `<X.Y.Z>` with the full version. The validator runs the tests, checks the
archive's exact contents, installs it in a temporary consumer, checks version,
help and synthetic SDK status, and verifies the bundled native helper's signature
and all runtime hashes. Temporary files are cleaned up; only the validated archive
remains. No SDK patching, emulator launch, Xcode or global npm installation is
required for this validation. Dependencies are not required by this package.

The native helper and artwork are committed assets. If those sources change,
rebuild and verify them with Xcode and a graphical macOS session before packing:

```sh
npm run build:runtime
npm run verify:icons
npm run build:launcher
npm run verify:names
```

Open a PR, complete review and wait for Node 22/24 CI checks. With explicit
release authorization, squash-merge it, then create and push an annotated
`vX.Y.Z` tag on that exact merged commit. The workflow checks the stable tag,
requires its commit to be on main, validates the package and publishes the exact
archive using OIDC. Publication provenance uses the checked-out tag commit,
including manual retries dispatched from main. No automatic version bump or extra GitHub Release is needed.

## Verification and recovery

Check the publishing run and npm `latest`, then install the exact published
version into a temporary consumer and check the CLI. npm may take a few minutes
to process a successful publication; retry verification without republishing.

For a confirmed failed publish with no accepted version, diagnose its logs and
retry the existing tag using the workflow's `release_tag` input, dispatched from
main. Never overwrite tags or published versions. A source fix requires a new
commit, version and tag. The release skill includes the full recovery checks.
