import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./finalize-release.mjs", import.meta.url));
const platforms = [
  ["linux-x86_64", "x86_64-unknown-linux-gnu", "tar.gz"],
  ["linux-aarch64", "aarch64-unknown-linux-gnu", "tar.gz"],
  ["macos-x86_64", "x86_64-apple-darwin", "tar.gz"],
  ["macos-aarch64", "aarch64-apple-darwin", "tar.gz"],
  ["windows-x86_64", "x86_64-pc-windows-msvc", "zip"],
];

function fixture(t, combined = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zincha-finalizer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, "assets");
  const output = path.join(root, "output");
  fs.mkdirSync(assets);
  const builds = [];
  for (const binary of combined ? ["zincha", "zincha-node"] : ["zincha"]) {
    for (const [platform, target, format] of platforms.filter(([p]) => binary === "zincha" || p.startsWith("linux-"))) {
      const base = `${binary}-v0.1.2-${platform}`;
      const artifact = `${base}.${format}`;
      const data = Buffer.from(`fixture bytes: ${artifact}`);
      fs.writeFileSync(path.join(assets, artifact), data);
      const build = {
        schema_version: 1, artifact, binary, release_tag: "v0.1.2",
        source_repo: binary === "zincha" ? "zinchain/zincha-sdk" : "zinchain/zincha",
        source_tag: "v0.1.2", source_commit: (binary === "zincha" ? "a" : "b").repeat(40),
        workflow_run_url: "https://github.com/zinchain/zincha-sdk/actions/runs/123",
        target_triple: target, platform, built_at: "2026-10-21T00:00:00Z",
        archive_format: format, archive_size_bytes: data.length,
        archive_sha256: crypto.createHash("sha256").update(data).digest("hex"),
      };
      const file = path.join(assets, `${base}.build.json`);
      fs.writeFileSync(file, JSON.stringify(build));
      builds.push({ file, build });
    }
  }
  return {
    assets, output, builds,
    run(kind) {
      const env = { ...process.env, TAG_NAME: "v0.1.2", RELEASE_DIR: assets, OUT_DIR: output, PRERELEASE: "true" };
      delete env.RELEASE_KIND;
      if (kind !== undefined) env.RELEASE_KIND = kind;
      return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    },
  };
}

test("CLI prerelease requires five archives and omits node install claims", (t) => {
  const f = fixture(t); const r = f.run("cli");
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.output, "release-manifest.json")));
  assert.equal(manifest.release_kind, "cli"); assert.equal(manifest.prerelease, true);
  assert.equal(manifest.required_assets.length, 5); assert.equal(manifest.artifacts.length, 5);
  assert.equal(fs.readFileSync(path.join(f.output, "SHA256SUMS"), "utf8").trim().split("\n").length, 10);
  const notes = fs.readFileSync(path.join(f.output, "RELEASE_NOTES.md"), "utf8");
  assert.match(notes, /^# Zincha CLI v0.1.2/);
  assert.match(notes, /Vega testnet prerelease/); assert.doesNotMatch(notes, /## Install Node/);
});

test("combined remains the default and requires both node platforms", (t) => {
  const f = fixture(t, true); const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.output, "release-manifest.json"))).artifacts.length, 7);
  assert.match(fs.readFileSync(path.join(f.output, "RELEASE_NOTES.md"), "utf8"), /## Install Node/);
});

test("CLI assets cannot silently satisfy a combined release", (t) => {
  const f = fixture(t); const r = f.run(); assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing required assets/);
});

test("CLI mode rejects accidental node artifacts", (t) => {
  const r = fixture(t, true).run("cli"); assert.notEqual(r.status, 0); assert.match(r.stderr, /must not contain node/);
});

test("CLI mode rejects a missing platform", (t) => {
  const f = fixture(t); fs.unlinkSync(path.join(f.assets, f.builds[0].build.artifact));
  assert.match(f.run("cli").stderr, /missing required assets/);
});

test("CLI mode rejects an undeclared extra platform", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.assets, "zincha-v0.1.2-extra.tar.gz"), "extra");
  const r = f.run("cli"); assert.notEqual(r.status, 0); assert.match(r.stderr, /exactly the five/);
});

test("unknown release mode fails closed", (t) => {
  const r = fixture(t).run("partial"); assert.notEqual(r.status, 0); assert.match(r.stderr, /RELEASE_KIND/);
});

for (const [name, mutate, expected] of [
  ["corrupt checksum", (b) => b.archive_sha256 = "0".repeat(64), /archive_sha256/],
  ["missing checksum", (b) => delete b.archive_sha256, /archive_sha256/],
  ["incorrect size", (b) => b.archive_size_bytes = 0, /archive_size_bytes/],
  ["wrong platform", (b) => b.platform = "macos-aarch64", /binary\/platform\/format/],
  ["wrong target", (b) => b.target_triple = "aarch64-apple-darwin", /target_triple mismatch/],
  ["wrong tag", (b) => b.source_tag = "v0.1.0", /source_tag mismatch/],
  ["mixed source commits", (b) => b.source_commit = "c".repeat(40), /one source commit/],
]) {
  test(`reject ${name}`, (t) => {
    const f = fixture(t); const { file, build } = f.builds[0]; mutate(build);
    fs.writeFileSync(file, JSON.stringify(build)); const r = f.run("cli");
    assert.notEqual(r.status, 0); assert.match(r.stderr, expected);
  });
}
