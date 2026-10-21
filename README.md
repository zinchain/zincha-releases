# Zincha Releases

Public binary download hub for Zincha release artifacts.

This repository intentionally does not store generated binaries in git. Download
release archives, checksums, and manifests from GitHub Releases:

<https://github.com/zinchain/zincha-releases/releases>

## Release Model

Each chain release tag, for example `v0.1.0`, has one public GitHub Release that
contains both binary families:

- `zincha`: public developer CLI, built from `zinchain/zincha-sdk`.
- `zincha-node`: node runtime, built from the hardened `zinchain/zincha` source.

The source repositories upload platform archives and per-build manifest
fragments. The finalizer workflow in this repository validates the required
asset set and publishes:

- `SHA256SUMS`
- `release-manifest.json`
- release notes with install and verification commands

## Required Assets

Every finalized release must include these `zincha` CLI archives:

- `zincha-vX.Y.Z-linux-x86_64.tar.gz`
- `zincha-vX.Y.Z-linux-aarch64.tar.gz`
- `zincha-vX.Y.Z-macos-x86_64.tar.gz`
- `zincha-vX.Y.Z-macos-aarch64.tar.gz`
- `zincha-vX.Y.Z-windows-x86_64.zip`

Every finalized first public runtime release must include these `zincha-node`
archives:

- `zincha-node-vX.Y.Z-linux-x86_64.tar.gz`
- `zincha-node-vX.Y.Z-linux-aarch64.tar.gz`

Node archives for macOS and Windows may be added after platform validation.
Quote verifier helper binaries are not part of the default public release
surface.

## Install

Pick the archive for your platform from the release page, unpack it, and place
the binary on your `PATH`.

Example for Linux x86_64:

```bash
tag=v0.1.0
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/zincha-$tag-linux-x86_64.tar.gz"
tar -xzf "zincha-$tag-linux-x86_64.tar.gz"
./zincha-$tag-linux-x86_64/zincha --version
```

Example for the Linux node runtime:

```bash
tag=v0.1.0
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/zincha-node-$tag-linux-x86_64.tar.gz"
tar -xzf "zincha-node-$tag-linux-x86_64.tar.gz"
./zincha-node-$tag-linux-x86_64/zincha-node --version
```

## Platform requirements

The `v0.1.0` archives are the Vega testnet prerelease. Linux GNU binaries are
built and smoke-tested on Ubuntu 24.04; the CLI macOS builds use macOS 15, and the
Windows CLI build uses Windows Server 2022. These are the build/test environments,
not a claim that every other operating-system version has been qualified.

The Linux archives require glibc 2.39 or newer. The node also requires
`libstdc++.so.6` providing `GLIBCXX_3.4.30` and `CXXABI_1.3.11`, plus the normal
GCC runtime. These requirements are checked from the compiled ELF files.

The Windows x64 CLI imports `VCRUNTIME140.dll` and the Universal C Runtime.
Install the current [Microsoft Visual C++ v14 x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
if that runtime is not already installed.

The frozen node source reports `zincha-node 0.1.0-genesis` from `--version`; this
is its existing internal label. The binary release tag is `v0.1.0`. Use the
archive's `VERSION` file and `release-manifest.json` to identify the exact source
commit. The public CLI reports `zincha 0.1.0`.

See the [v0.1.0 build verification record](validation/v0.1.0.json) for source
commits, successful build jobs, checksums, and the scope of validation.

## Verify

Download the aggregate checksums next to the archive and verify before running
the binary:

```bash
tag=v0.1.0
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/SHA256SUMS"
curl -fsSLO "$base/zincha-$tag-linux-x86_64.tar.gz"
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Inspect `release-manifest.json` to trace each binary to its source repository,
source tag, source commit, target triple, workflow run URL, build time, and
SHA256 checksum.

## Maintainer Flow

1. Promote hardened code from `zincha-dev` into `zinchain/zincha`.
2. Export and merge the public SDK surface into `zinchain/zincha-sdk`.
3. Tag both source repositories with the same release tag.
4. Manually dispatch the source workflows with that tag to upload `zincha-node`
   and `zincha` archives, one platform at a time.
5. Run `Finalize Release` in this repository for that tag; use
   `prerelease=true` for Vega testnet builds.
6. Publish only after the finalizer validates the required assets.

The upload workflows require a `ZINCHA_RELEASES_TOKEN` secret in the source
repositories. The token should be a least-privilege GitHub App token or
fine-grained PAT with `contents: write` access to this repository.

When updating an unpublished draft through the REST API, explicitly preserve its
`tag_name` along with the changed metadata. The finalizer likewise passes the tag
explicitly when publishing. If a platform upload fails, preserve successful
assets and retry only missing platforms from the original source tag. Do not
move a source tag to repair release tooling or publish an incomplete asset set.
