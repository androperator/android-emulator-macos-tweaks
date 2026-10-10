---
name: release-package
description: Prepare, publish, resume, or verify an @androperator/emulator-macos-tweaks release through reviewed PRs and GitHub Trusted Publishing.
---

# Release @androperator/emulator-macos-tweaks

Resume from the first incomplete stage. Preparation or verification alone does
not authorize merging or publication. An explicit request to complete a release
authorizes merging its reviewed release PR and pushing its release tag.

## Contracts

- Repository: `androperator/android-emulator-macos-tweaks`.
- Package: `@androperator/emulator-macos-tweaks`; command: `androperator-emulator-tweaks`.
- Version: `package.json`; CLI reads the installed manifest. No lockfile or separate version constant.
- Stable tag: `vX.Y.Z`, matching the manifest exactly.
- Publisher: `.github/workflows/publish-npm.yml`, GitHub-hosted macOS, Node 24 and npm 11.5.1+ using OIDC. No npm token or local login is needed once trust is configured.
- Main requires `test (22)` and `test (24)`; squash merges only.
- Runtime helper and icons are committed release assets. Do not rebuild them for a version-only release.
- AVD naming stays experimental and outside the npm archive. No Homebrew update or GitHub Release is part of this workflow.

## Prepare

1. Inspect the worktree, preserve unrelated changes, fetch `origin/main`, and
   create a release branch. Inspect existing PRs, tags, workflow runs and npm
   state first when resuming; reuse completed stages.
2. Read the current manifest, npm stable version and local/remote tags. Require
   full stable `X.Y.Z` syntax. If unspecified, infer the next patch only after
   establishing the baseline. Auth/network failures do not prove availability.
   Routine next patch or next minor releases can proceed under release authority.
   Major increases, skipped version sequences or downgrades require explicit
   confirmation of the target and baseline. Published versions cannot be reused.
3. Set the version with `npm version <version> --no-git-tag-version`. Add one
   CHANGELOG entry grounded in changes since the preceding release. Keep public
   version claims accurate; the first manual release was `1.0.0`.
4. On macOS run `RELEASE_TAG=v<version> npm run release:pack -- /tmp/emulator-macos-tweaks-release.tgz`.
   This runs tests, checks exact archive contents, installs the archive in a
   temporary consumer and verifies CLI output, synthetic SDK status and native
   runtime hashes/signing. It does not modify the installed SDK or run an emulator.
   If native sources/assets changed, also rebuild with `npm run build:runtime`
   and run `npm run verify:icons` with Xcode and a graphical macOS session before
   packing; commit the complete regenerated runtime and manifest together.
5. Commit, run the requested Astra review workflow, and open/update a PR. Wait
   for both required checks. Never push release changes directly to main.

## Publish

1. With release authorization, squash-merge the reviewed release PR and verify
   its merged SHA through `gh pr view`. Fetch it and read its manifest directly
   with `git show <merged-sha>:package.json`; verify the intended version.
2. Recheck npm version availability and local/remote tag absence. Never overwrite
   a tag. Create an annotated `v<version>` tag on that exact merged SHA and push
   only the tag; this starts publication. Do not also publish manually.
3. Find the `publish-npm.yml` run for that tag and SHA and watch it to completion.
   Missing, failed or timed-out runs are unfinished publication. Report the run
   URL and failing step. npm trust must be configured as described in
   [docs/releasing.md](../../../docs/releasing.md); saved settings alone do not
   prove a successful OIDC publish.

## Verify and recover

- Confirm the remote annotated tag's peeled commit equals the merged SHA and
  verify the publish run belongs to that tag/SHA.
- Check `npm view @androperator/emulator-macos-tweaks@<version> version --prefer-online`
  and the package's `dist-tags`; stable `latest` must equal the target.
- Install that exact registry version in a temporary consumer on macOS. Probe
  `--version`, `--help`, no-argument usage and read-only `status`. Preserve the
  user's global installation and SDK; clean up the consumer afterward.
- npm may accept publication while still processing it. Retry registry metadata
  and installation roughly every 30 seconds for up to five minutes, with progress
  updates. Do not republish while processing. If still unavailable, report
  accepted publication with verification pending and its exact failing check.
- Before retrying, inspect npm, the tag and workflow logs. If an unchanged tag's
  publish failed with no accepted version, diagnose the failure and dispatch
  `publish-npm.yml` from main with `release_tag` set to the existing tag. Never
  move the tag; if a source fix needs a new commit, use a new version and tag.
- No automatic post-release version bump. Report version, merged SHA, tag,
  PR/run URLs, registry installation results and unfinished stages.
