# Security Policy

## Reporting Vulnerabilities

Report suspected vulnerabilities privately to the maintainers before public
disclosure. Include affected release tags, operating system, reproduction steps,
logs, and any relevant `release-manifest.json` entries.

## Release Integrity

Zincha binary releases are published as GitHub Release assets, not committed
binaries. A finalized release must include:

- platform archives for the required `zincha` and `zincha-node` targets
- per-build manifest fragments uploaded by the source build workflows
- aggregate `SHA256SUMS`
- aggregate `release-manifest.json`

Users should verify the archive checksum before execution:

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
```

When artifact attestations or detached signatures are available for a release,
prefer verifying those in addition to the checksum. Checksums prove artifact
integrity relative to the release page; attestations or signatures add
provenance.

## Scope

This repository is a public distribution point. Source code issues should be
reported against the source repository that produced the affected artifact:

- `zincha` CLI: `zinchain/zincha-sdk`
- `zincha-node`: `zinchain/zincha`
