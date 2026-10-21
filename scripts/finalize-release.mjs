#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const tag = process.env.TAG_NAME || process.argv[2];
const releaseKind = process.env.RELEASE_KIND || "combined";
const prerelease = process.env.PRERELEASE === "true";
if (!["combined", "cli"].includes(releaseKind)) {
  throw new Error("RELEASE_KIND must be combined or cli");
}
const releaseDir = path.resolve(
  process.env.RELEASE_DIR || path.join(process.cwd(), "dist", "release-assets"),
);
const outDir = path.resolve(
  process.env.OUT_DIR || path.join(process.cwd(), "dist", "finalized"),
);

if (!tag || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error("TAG_NAME or argv[2] must be a release tag such as v0.1.0");
}

if (!fs.existsSync(releaseDir)) {
  throw new Error(`release asset directory does not exist: ${releaseDir}`);
}

const required = [
  ["zincha", "linux-x86_64", "x86_64-unknown-linux-gnu", "tar.gz"],
  ["zincha", "linux-aarch64", "aarch64-unknown-linux-gnu", "tar.gz"],
  ["zincha", "macos-x86_64", "x86_64-apple-darwin", "tar.gz"],
  ["zincha", "macos-aarch64", "aarch64-apple-darwin", "tar.gz"],
  ["zincha", "windows-x86_64", "x86_64-pc-windows-msvc", "zip"],
  ["zincha-node", "linux-x86_64", "x86_64-unknown-linux-gnu", "tar.gz"],
  ["zincha-node", "linux-aarch64", "aarch64-unknown-linux-gnu", "tar.gz"],
].filter(([binary]) => releaseKind === "combined" || binary === "zincha")
  .map(([binary, platform, targetTriple, format]) => ({
  binary,
  platform,
  targetTriple,
  format,
  archive: `${binary}-${tag}-${platform}.${format}`,
  build: `${binary}-${tag}-${platform}.build.json`,
}));

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to parse ${path.basename(filePath)}: ${error.message}`);
  }
}

function requireString(object, key, fileName) {
  if (typeof object[key] !== "string" || object[key].trim() === "") {
    throw new Error(`${fileName} must contain non-empty string field ${key}`);
  }
  return object[key];
}

const files = new Set(fs.readdirSync(releaseDir));
const missing = [];
for (const item of required) {
  if (!files.has(item.archive)) missing.push(item.archive);
  if (!files.has(item.build)) missing.push(item.build);
}
if (missing.length > 0) {
  throw new Error(`release ${tag} is missing required assets:\n${missing.join("\n")}`);
}

const archivePattern = new RegExp(
  `^(zincha|zincha-node)-${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(.+)\\.(tar\\.gz|zip)$`,
);
const archiveNames = [...files].filter((name) => archivePattern.test(name)).sort();
if (releaseKind === "cli" && archiveNames.some((name) => name.startsWith("zincha-node-"))) {
  throw new Error("CLI-only releases must not contain node archives");
}
if (releaseKind === "cli" && archiveNames.length !== required.length) {
  throw new Error("CLI-only releases must contain exactly the five required platform archives");
}
const fragmentNames = [...files].filter((name) => name.endsWith(".build.json")).sort();

for (const archive of archiveNames) {
  const build = archive.replace(/\.(tar\.gz|zip)$/, ".build.json");
  if (!files.has(build)) {
    throw new Error(`${archive} does not have matching build manifest ${build}`);
  }
}

for (const build of fragmentNames) {
  const manifest = readJson(path.join(releaseDir, build));
  const artifact = requireString(manifest, "artifact", build);
  if (!files.has(artifact)) {
    throw new Error(`${build} points at missing artifact ${artifact}`);
  }
  if (!archivePattern.test(artifact)) {
    throw new Error(`${build} artifact does not match release tag ${tag}: ${artifact}`);
  }
}

const requiredByArchive = new Map(required.map((item) => [item.archive, item]));
const artifacts = archiveNames.map((archive) => {
  const archivePath = path.join(releaseDir, archive);
  const buildName = archive.replace(/\.(tar\.gz|zip)$/, ".build.json");
  const buildPath = path.join(releaseDir, buildName);
  const build = readJson(buildPath);
  const checksum = sha256(archivePath);
  const size = fs.statSync(archivePath).size;
  const expected = requiredByArchive.get(archive);

  if (build.schema_version !== 1) {
    throw new Error(`${buildName} must use schema_version 1`);
  }
  if (build.artifact !== archive) {
    throw new Error(`${buildName} artifact mismatch: expected ${archive}, got ${build.artifact}`);
  }
  if (build.release_tag !== tag) {
    throw new Error(`${buildName} release_tag mismatch: expected ${tag}, got ${build.release_tag}`);
  }
  if (build.archive_sha256 !== checksum) {
    throw new Error(`${buildName} archive_sha256 does not match uploaded archive`);
  }
  if (build.archive_size_bytes !== size) {
    throw new Error(`${buildName} archive_size_bytes does not match uploaded archive`);
  }

  const binary = requireString(build, "binary", buildName);
  const sourceRepo = requireString(build, "source_repo", buildName);
  const sourceTag = requireString(build, "source_tag", buildName);
  const sourceCommit = requireString(build, "source_commit", buildName);
  const workflowRunUrl = requireString(build, "workflow_run_url", buildName);
  const targetTriple = requireString(build, "target_triple", buildName);
  const platform = requireString(build, "platform", buildName);
  const builtAt = requireString(build, "built_at", buildName);
  const [, archiveBinary, archivePlatform, archiveFormat] = archive.match(archivePattern);
  if (binary !== archiveBinary || platform !== archivePlatform || build.archive_format !== archiveFormat) {
    throw new Error(`${buildName} binary/platform/format does not match archive name`);
  }

  if (!["zincha", "zincha-node"].includes(binary)) {
    throw new Error(`${buildName} has unsupported binary ${binary}`);
  }
  if (binary === "zincha" && sourceRepo !== "zinchain/zincha-sdk") {
    throw new Error(`${buildName} source_repo must be zinchain/zincha-sdk`);
  }
  if (binary === "zincha-node" && sourceRepo !== "zinchain/zincha") {
    throw new Error(`${buildName} source_repo must be zinchain/zincha`);
  }
  if (sourceTag !== tag) {
    throw new Error(`${buildName} source_tag mismatch: expected ${tag}, got ${sourceTag}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error(`${buildName} source_commit must look like a git commit SHA`);
  }
  if (!/^https:\/\/github\.com\/.+\/actions\/runs\/[0-9]+/.test(workflowRunUrl) && workflowRunUrl !== "local") {
    throw new Error(`${buildName} workflow_run_url must point at a GitHub Actions run`);
  }
  if (Number.isNaN(Date.parse(builtAt))) {
    throw new Error(`${buildName} built_at must be an ISO-like timestamp`);
  }
  if (expected && targetTriple !== expected.targetTriple) {
    throw new Error(`${buildName} target_triple mismatch: expected ${expected.targetTriple}`);
  }

  return {
    name: archive,
    binary,
    platform,
    target_triple: targetTriple,
    archive_format: build.archive_format || (archive.endsWith(".zip") ? "zip" : "tar.gz"),
    size_bytes: size,
    sha256: checksum,
    source_repo: sourceRepo,
    source_tag: sourceTag,
    source_commit: sourceCommit,
    workflow_run_url: workflowRunUrl,
    built_at: builtAt,
    build_manifest: buildName,
  };
});

for (const binary of new Set(artifacts.map((artifact) => artifact.binary))) {
  const commits = new Set(artifacts.filter((artifact) => artifact.binary === binary).map((artifact) => artifact.source_commit));
  if (commits.size !== 1) {
    throw new Error(`${binary} archives must use one source commit across platforms`);
  }
}

const checksumFiles = [...archiveNames, ...fragmentNames].sort();
const sums = checksumFiles
  .map((name) => `${sha256(path.join(releaseDir, name))}  ${name}`)
  .join("\n") + "\n";

const generatedAt = new Date().toISOString();
const manifest = {
  schema_version: 1,
  release_tag: tag,
  release_kind: releaseKind,
  prerelease,
  generated_at: generatedAt,
  required_assets: required.map((item) => item.archive),
  artifacts,
};

const assetLines = artifacts
  .map(
    (artifact) =>
      `- ${artifact.name} (${artifact.target_triple}, ${artifact.source_repo}@${artifact.source_commit.slice(0, 12)})`,
  )
  .join("\n");

const notes = `# Zincha ${tag}

${prerelease ? "Vega testnet prerelease. " : ""}${releaseKind === "cli" ? "This release updates only the public developer CLI. It does not include or replace the node runtime; the existing node release remains unchanged." : "This release contains public CLI and node binary archives built from tagged source repositories."}

## Assets

${assetLines}

## Verify Downloads

\`\`\`bash
tag=${tag}
base=https://github.com/zinchain/zincha-releases/releases/download/$tag
curl -fsSLO "$base/SHA256SUMS"
curl -fsSLO "$base/zincha-$tag-linux-x86_64.tar.gz"
shasum -a 256 -c SHA256SUMS --ignore-missing
\`\`\`

## Install CLI

\`\`\`bash
tag=${tag}
tar -xzf "zincha-$tag-linux-x86_64.tar.gz"
./zincha-$tag-linux-x86_64/zincha --version
\`\`\`

${releaseKind === "combined" ? `## Install Node

\`\`\`bash
tag=${tag}
tar -xzf "zincha-node-$tag-linux-x86_64.tar.gz"
./zincha-node-$tag-linux-x86_64/zincha-node --version
\`\`\`

` : ""}

See \`release-manifest.json\` for source repository, source tag, source commit, workflow run URL, target triple, build time, and checksum metadata for every binary archive.

See [platform requirements](https://github.com/zinchain/zincha-releases/blob/${tag}/README.md#platform-requirements) for build/test environments, runtime dependencies, and version-label details.
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), sums);
fs.writeFileSync(
  path.join(outDir, "release-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
fs.writeFileSync(path.join(outDir, "RELEASE_NOTES.md"), notes);

console.log(`validated ${artifacts.length} binary archives for ${tag}`);
console.log(`wrote ${path.join(outDir, "SHA256SUMS")}`);
console.log(`wrote ${path.join(outDir, "release-manifest.json")}`);
