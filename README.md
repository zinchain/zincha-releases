# Zincha Releases

Public binary download hub for Zincha release artifacts.

This repository intentionally does not store generated binaries in git. Download
release archives, checksums, and manifests from GitHub Releases:

<https://github.com/zinchain/zincha-releases/releases>

## Release Model

A combined chain release, for example `v0.1.0`, contains both binary families:

- `zincha`: public developer CLI, built from `zinchain/zincha-sdk`.
- `zincha-node`: node runtime, built from the hardened `zinchain/zincha` source.

A CLI-only patch release contains all five CLI platforms and
does not replace or relabel the node release. The finalizer requires an explicit
`release_kind=cli` selection; `combined` remains the default and still requires
both Linux node archives. CLI-only releases reject accidental node archives.

The current [Vega v0.1.2 bundle](https://github.com/zinchain/zincha-releases/releases/tag/v0.1.2)
contains **CLI 0.1.2 + unchanged node 0.1.0** directly on the same release page.
The node archives and their build manifests retain their original v0.1.0 names,
source commits and bytes. The bundle's `SHA256SUMS` and `release-manifest.json`
cover all seven archives; `component_tags` records each component's version.
The original v0.1.0 release remains available and unchanged.

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

Every finalized `combined` release must also include these `zincha-node`
archives (the node version may differ from the bundle version):

- `zincha-node-vX.Y.Z-linux-x86_64.tar.gz`
- `zincha-node-vX.Y.Z-linux-aarch64.tar.gz`

Node archives for macOS and Windows may be added after platform validation.
Quote verifier helper binaries are not part of the default public release
surface.

## Install

Pick the archive for your platform from the release page, unpack it, and place
the binary on your `PATH`.

Example for the current CLI on Linux x86_64:

```bash
tag=v0.1.2
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/zincha-$tag-linux-x86_64.tar.gz"
tar -xzf "zincha-$tag-linux-x86_64.tar.gz"
./zincha-$tag-linux-x86_64/zincha --version
```

Example for the unchanged Linux node from the same bundle:

```bash
release_tag=v0.1.2
node_tag=v0.1.0
base=https://github.com/zinchain/zincha-releases/releases/download/$release_tag
curl -fsSLO "$base/zincha-node-$node_tag-linux-x86_64.tar.gz"
tar -xzf "zincha-node-$node_tag-linux-x86_64.tar.gz"
./zincha-node-$node_tag-linux-x86_64/zincha-node --version
```

## Platform requirements

The CLI `v0.1.2` and unchanged node `v0.1.0` archives are Vega testnet
prereleases. Linux GNU binaries are built and smoke-tested on Ubuntu 24.04; the CLI macOS builds use macOS 15, and the
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
commit. The current public CLI reports `zincha 0.1.2`.

See the [v0.1.2 download verification record](validation/v0.1.2.json) for the
current CLI source, archive/binary hashes, native environments and confirmed
Vega transaction evidence. All five published downloads passed sequential native
provenance, version/help, RPC, transaction submission, canonical confirmation,
finality, balance and nonce checks. The same Apple Silicon archive also passed
on the local macOS 15.7.3 machine. These are functional checks, not throughput or
endurance qualification.

| CLI platform | Native download and live Vega transfer |
| --- | --- |
| Linux x86_64 | Passed |
| Linux ARM64 | Passed |
| macOS Intel | Passed |
| macOS Apple Silicon | Passed, plus local Mac verification |
| Windows x64 | Passed |

[Sequential native test workflow](https://github.com/zinchain/zincha-releases/actions/runs/39693787011).
The [v0.1.0 build verification record](validation/v0.1.0.json) retains the node
source, checksums and original validation scope; this CLI patch did not retest or
rebuild the node archives.

## Verify

Download the aggregate checksums next to the archive and verify before running
the binary:

```bash
tag=v0.1.2
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/SHA256SUMS"
curl -fsSLO "$base/zincha-$tag-linux-x86_64.tar.gz"
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Inspect `release-manifest.json` to trace each binary to its source repository,
source tag, source commit, target triple, workflow run URL, build time, and
SHA256 checksum.

## Maintainer Flow — combined release

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

## Reuse unchanged node binaries in a newer bundle

1. Copy the two original Linux node archives and their `.build.json` files to the
   destination release without renaming, rebuilding or modifying their bytes.
2. Dispatch **Finalize Release** with the destination `tag`,
   `release_kind=combined`, and the explicit original `node_tag` (for v0.1.2,
   `node_tag=v0.1.0`). Keep `prerelease=true` for Vega. Use
   `force_republish=true` only when replacing the existing aggregate checksums
   and manifest, as required when expanding an already finalized CLI-only release.
3. The workflow downloads the original node files independently and compares
   every byte before finalizing. The original build/source tags stay unchanged;
   the aggregate manifest records both versions. Blank `node_tag` preserves the
   normal same-version combined-release behavior.
4. Download the new aggregate metadata and copied files, verify their hashes,
   and retain a record of the original and destination asset identities. Existing
   CLI archives must remain unchanged. The CLI download verifier supports either
   a CLI-only release or a bundle containing the two node archives.

## Maintainer flow — CLI-only patch

1. Select the reviewed SDK commit and an unused version tag matching its Cargo
   version. Run its sequential offline checks, then create the immutable tag
   in `zinchain/zincha-sdk`. Do not move an existing tag.
2. Dispatch SDK **Release Binaries** with that tag, `platforms=all` and
   `force_republish=false`. Approve the existing release environment. Its
   five platform build/smoke/upload jobs run one at a time.
3. Wait for all five archives, build manifests and provenance attestations.
   Run this repository's finalizer tests and review the downloaded assets.
4. Dispatch **Finalize Release** with the tag, `release_kind=cli`,
   `prerelease=true` for Vega, and `force_republish=false`. This publishes a
   CLI-only manifest and notes; no new node tag or node build is required.
5. Dispatch **Verify CLI Prerelease Downloads** with the tag and the full SDK
   source commit. It downloads the published assets on native Linux x86/ARM,
   macOS Intel/Apple Silicon and Windows x64 runners, sequentially. Each checks
   hashes, manifests, contents and signed provenance before running the CLI,
   public Vega reads and a bounded faucet-funded transfer/finality/balance audit.
6. Preserve the per-platform verification artifacts outside Actions' 30-day
   retention window. Record successes and any failures under `validation/`.
   If a job fails, investigate before using **Re-run failed jobs**; never count
   a failed or missing platform observation as a pass.

Local release-tool checks (Node 22+ and Python 3.12), one test at a time:

```bash
node --test --test-concurrency=1 scripts/finalize-release.test.mjs
python3 -m unittest discover -s scripts -p 'test_verify_cli_download.py'
```

Download verification does not rebuild the binary. It checks the exact published
bytes. Functional transfers do not establish throughput or endurance qualification.
