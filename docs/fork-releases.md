# C3nHx Windows releases

Releases use `v<official version>-c3nhx.<patch>`, for example
`v1.1.85-c3nhx.1`. The official version identifies the upstream baseline;
the final positive integer counts fork patches for that baseline. Increment it
for each new build, including packaging fixes. When upgrading upstream, change
the baseline and reset the fork patch to 1. Never reuse an existing release tag.

`fork-release.json` records the official version, its peeled commit SHA, and the
fork patch. CI verifies that the official tag still resolves to that commit and
that the release source contains it. `package.json` stays at the upstream
development placeholder; CI writes the full fork version to the package and
lockfile before building. Local/PR builds add `.dev.<source SHA>`.

To publish, commit the updated configuration and code, then push that commit to
`release/windows-v1.1.85-c3nhx.1` (substitute the configured version). A matching
version tag also triggers publishing. Alternatively, run `build-packages`
manually with `publish_release=true`; leave `release_tag` empty to use the
configuration, or provide the matching tag explicitly.

The Windows build verifies the official baseline and existing tag, runs the
native ConPTY and tray checks, and publishes installer, portable EXE, ZIP,
update metadata, and checksums to C3nHx/Netcatty. The release job creates the
matching tag only after the build passes. Branch publishing and tag publishing
use the same version checks.

The `-c3nhx.N` suffix is a SemVer prerelease identifier, so these releases are
marked as prereleases on GitHub and use the `c3nhx` updater channel. The update
banner also selects only this fork's published channel. Files and the app's
version display include the full suffix. Official releases and their tags are
unchanged.
