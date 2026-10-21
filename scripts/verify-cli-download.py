#!/usr/bin/env python3
"""Validate and unpack one finalized CLI download before native execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import struct
import tarfile
import zipfile

PLATFORMS = {
    "linux-x86_64": ("x86_64-unknown-linux-gnu", "tar.gz"),
    "linux-aarch64": ("aarch64-unknown-linux-gnu", "tar.gz"),
    "macos-x86_64": ("x86_64-apple-darwin", "tar.gz"),
    "macos-aarch64": ("aarch64-apple-darwin", "tar.gz"),
    "windows-x86_64": ("x86_64-pc-windows-msvc", "zip"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    require(re.fullmatch(r"v\d+\.\d+\.\d+", args.tag), "invalid tag")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_commit), "source must be a full commit SHA")
    root = args.directory.resolve()
    release = json.loads((root / "github-release.json").read_text())
    require(release["tag_name"] == args.tag and release["prerelease"] and not release["draft"], "not the requested finalized prerelease")
    manifest = json.loads((root / "release-manifest.json").read_text())
    require(manifest["schema_version"] == 1 and manifest["release_tag"] == args.tag, "unsupported release manifest")
    require(manifest["release_kind"] == "cli" and manifest["prerelease"], "expected a CLI-only prerelease")
    expected_names = {f"zincha-{args.tag}-{p}.{f}" for p, (_, f) in PLATFORMS.items()}
    require(set(manifest["required_assets"]) == expected_names, "incomplete required CLI matrix")
    require(len(manifest["artifacts"]) == 5 and {a["name"] for a in manifest["artifacts"]} == expected_names, "unexpected CLI asset set")
    target, archive_format = PLATFORMS[args.platform]
    package = f"zincha-{args.tag}-{args.platform}"
    archive = root / f"{package}.{archive_format}"
    fragment = root / f"{package}.build.json"
    sums = {}
    for line in (root / "SHA256SUMS").read_text().splitlines():
        checksum, name = line.split("  ", 1)
        require(re.fullmatch(r"[0-9a-f]{64}", checksum) and name not in sums, "invalid checksum list")
        sums[name] = checksum
    for file in [archive, fragment]:
        require(sums.get(file.name) == digest(file), f"aggregate checksum mismatch: {file.name}")
    record = next(a for a in manifest["artifacts"] if a["name"] == archive.name)
    build = json.loads(fragment.read_text())
    for data in [record, build]:
        require(data["binary"] == "zincha" and data["platform"] == args.platform and data["target_triple"] == target, "artifact identity mismatch")
        require(data["source_repo"] == "zinchain/zincha-sdk" and data["source_tag"] == args.tag and data["source_commit"] == args.source_commit, "source identity mismatch")
        require(data["archive_format"] == archive_format, "archive format mismatch")
    require(record["sha256"] == build["archive_sha256"] == digest(archive), "archive hash mismatch")
    require(record["size_bytes"] == build["archive_size_bytes"] == archive.stat().st_size, "archive size mismatch")
    require(build["schema_version"] == 1 and build["release_tag"] == args.tag and build["artifact"] == archive.name, "build fragment mismatch")
    executable = "zincha.exe" if args.platform.startswith("windows") else "zincha"
    expected_files = {f"{package}/{name}" for name in [executable, "README.md", "LICENSE", "VERSION"]}
    output = root / "unpacked"
    require(not output.exists(), "unpack directory must be new")
    payloads = {}
    if archive_format == "zip":
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                require(member.filename in expected_files and member.filename not in payloads, "unexpected or duplicate ZIP member")
                require(stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG), "linked or special ZIP member")
                require(member.file_size <= 256 * 1024 * 1024, "oversized ZIP member")
                payloads[member.filename] = bundle.read(member)
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                if member.isdir():
                    require(member.name == package, "unexpected archive directory")
                    continue
                require(member.isfile() and member.name in expected_files and member.name not in payloads, "unexpected, linked or duplicate tar member")
                if member.name == f"{package}/{executable}":
                    require(member.mode & 0o111, "binary is not executable in the archive")
                require(member.size <= 256 * 1024 * 1024, "oversized tar member")
                payloads[member.name] = bundle.extractfile(member).read()
    require(set(payloads) == expected_files, "incomplete package contents")
    binary_bytes = payloads[f"{package}/{executable}"]
    if args.platform.startswith("linux"):
        require(binary_bytes[:6] == b"\x7fELF\x02\x01", "expected little-endian ELF64")
        machine = struct.unpack_from("<H", binary_bytes, 18)[0]
        require(machine == (183 if "aarch64" in args.platform else 62), "ELF architecture mismatch")
    elif args.platform.startswith("macos"):
        require(binary_bytes[:4] == b"\xcf\xfa\xed\xfe", "expected Mach-O 64")
        machine = struct.unpack_from("<I", binary_bytes, 4)[0]
        require(machine == (0x0100000C if "aarch64" in args.platform else 0x01000007), "Mach-O architecture mismatch")
    else:
        require(binary_bytes[:2] == b"MZ", "expected Windows PE executable")
        offset = struct.unpack_from("<I", binary_bytes, 0x3C)[0]
        require(binary_bytes[offset:offset + 4] == b"PE\0\0" and struct.unpack_from("<H", binary_bytes, offset + 4)[0] == 0x8664, "PE architecture mismatch")
    version = dict(line.split("=", 1) for line in payloads[f"{package}/VERSION"].decode().splitlines())
    for key, value in {"tag": args.tag, "binary": "zincha", "source_repo": "zinchain/zincha-sdk", "source_tag": args.tag, "source_commit": args.source_commit, "target_triple": target, "platform": args.platform}.items():
        require(version.get(key) == value, f"VERSION mismatch: {key}")
    for name, data in payloads.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    binary = output / package / executable
    binary.chmod(0o755)
    verification = {"passed": True, "tag": args.tag, "platform": args.platform, "source_commit": args.source_commit,
                    "archive_sha256": digest(archive), "binary_sha256": digest(binary),
                    "runner": platform.platform(), "machine": platform.machine(),
                    "scope": "Archive integrity and contents; native execution and provenance are separate workflow steps"}
    (root / "download-verification.json").write_text(json.dumps(verification, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as stream:
            stream.write(f"binary={binary.as_posix()}\narchive={archive.as_posix()}\n")
    print(f"Verified and unpacked {archive.name}")


if __name__ == "__main__":
    main()
