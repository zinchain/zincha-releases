"""Offline rejection tests; synthetic executable headers are never executed."""
import hashlib
import io
import json
from pathlib import Path
import runpy
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("verify-cli-download.py")
PLATFORMS = runpy.run_path(str(SCRIPT))["PLATFORMS"]
TAG = "v0.1.2"
SOURCE = "a" * 40


class DownloadChecks(unittest.TestCase):
    def fixture(self, selected="linux-x86_64", extra=None, wrong_arch=False, executable_mode=0o755):
        temporary = tempfile.TemporaryDirectory(prefix="zincha-download-test-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        records = []
        for platform, (target, extension) in PLATFORMS.items():
            name = f"zincha-{TAG}-{platform}.{extension}"
            records.append({"name": name, "binary": "zincha", "platform": platform,
                            "target_triple": target, "source_repo": "zinchain/zincha-sdk",
                            "source_tag": TAG, "source_commit": SOURCE, "archive_format": extension})
        record = next(r for r in records if r["platform"] == selected)
        package = f"zincha-{TAG}-{selected}"
        executable = "zincha.exe" if selected.startswith("windows") else "zincha"
        binary = bytearray(128)
        if selected.startswith("linux"):
            binary[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", binary, 18, 0 if wrong_arch else (183 if "aarch64" in selected else 62))
        elif selected.startswith("macos"):
            binary[:4] = b"\xcf\xfa\xed\xfe"
            struct.pack_into("<I", binary, 4, 0x0100000C if "aarch64" in selected else 0x01000007)
        else:
            binary[:2] = b"MZ"; struct.pack_into("<I", binary, 0x3C, 64)
            binary[64:68] = b"PE\0\0"; struct.pack_into("<H", binary, 68, 0x8664)
        version = {"tag": TAG, "binary": "zincha", "source_repo": "zinchain/zincha-sdk", "source_tag": TAG,
                   "source_commit": SOURCE, "target_triple": record["target_triple"], "platform": selected}
        files = {f"{package}/{executable}": bytes(binary), f"{package}/README.md": b"fixture",
                 f"{package}/LICENSE": b"fixture", f"{package}/VERSION": "\n".join(f"{k}={v}" for k, v in version.items()).encode()}
        if extra:
            files[extra] = b"unwanted"
        archive = root / record["name"]
        if record["archive_format"] == "zip":
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, data in files.items(): bundle.writestr(name, data)
        else:
            with tarfile.open(archive, "w:gz") as bundle:
                for name, data in files.items():
                    info = tarfile.TarInfo(name); info.size = len(data)
                    info.mode = executable_mode if name.endswith("/zincha") else 0o644
                    bundle.addfile(info, io.BytesIO(data))
        record["sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        record["size_bytes"] = archive.stat().st_size
        build = {**record, "schema_version": 1, "artifact": archive.name, "release_tag": TAG,
                 "archive_sha256": record["sha256"], "archive_size_bytes": record["size_bytes"]}
        fragment = root / f"{package}.build.json"; fragment.write_text(json.dumps(build))
        (root / "SHA256SUMS").write_text("\n".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}" for p in [archive, fragment]) + "\n")
        (root / "github-release.json").write_text(json.dumps({"tag_name": TAG, "prerelease": True, "draft": False}))
        (root / "release-manifest.json").write_text(json.dumps({"schema_version": 1, "release_tag": TAG,
            "release_kind": "cli", "prerelease": True, "required_assets": [r["name"] for r in records], "artifacts": records}))
        return root, archive

    def run_check(self, root, platform="linux-x86_64", source=SOURCE):
        return subprocess.run([sys.executable, str(SCRIPT), "--tag", TAG, "--platform", platform,
                               "--source-commit", source, "--directory", str(root)], capture_output=True, text=True)

    def test_all_platform_headers_and_formats(self):
        for platform in PLATFORMS:
            with self.subTest(platform=platform):
                root, _ = self.fixture(platform); result = self.run_check(root, platform)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(json.loads((root / "download-verification.json").read_text())["passed"])

    def test_corrupt_archive(self):
        root, archive = self.fixture(); archive.write_bytes(archive.read_bytes() + b"changed")
        self.assertIn("aggregate checksum mismatch", self.run_check(root).stderr)
        self.assertFalse((root / "unpacked").exists())

    def test_unexpected_paths_in_each_archive_format(self):
        for platform in ["linux-x86_64", "windows-x86_64"]:
            with self.subTest(platform=platform):
                root, _ = self.fixture(platform, extra="../outside")
                result = self.run_check(root, platform)
                self.assertNotEqual(result.returncode, 0); self.assertIn("unexpected", result.stderr)
                self.assertFalse((root / "unpacked").exists())

    def test_wrong_source(self):
        root, _ = self.fixture(); result = self.run_check(root, source="b" * 40)
        self.assertNotEqual(result.returncode, 0); self.assertIn("source identity mismatch", result.stderr)

    def test_wrong_architecture(self):
        root, _ = self.fixture(wrong_arch=True); result = self.run_check(root)
        self.assertNotEqual(result.returncode, 0); self.assertIn("ELF architecture mismatch", result.stderr)

    def test_nonexecutable_archive_is_not_repaired_silently(self):
        root, _ = self.fixture(executable_mode=0o644); result = self.run_check(root)
        self.assertNotEqual(result.returncode, 0); self.assertIn("not executable", result.stderr)

    def test_draft_is_not_a_finalized_download(self):
        root, _ = self.fixture()
        (root / "github-release.json").write_text(json.dumps({"tag_name": TAG, "prerelease": True, "draft": True}))
        result = self.run_check(root)
        self.assertNotEqual(result.returncode, 0); self.assertIn("finalized prerelease", result.stderr)


if __name__ == "__main__":
    unittest.main()
