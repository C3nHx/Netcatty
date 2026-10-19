const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveVersion, setVersion } = require("./set-fork-version.cjs");

const config = { upstreamVersion: "1.1.85", upstreamCommit: "4e2b17283f5609e9cba52c6200c1dcfcb568237c", patch: 1 };
const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: `0000001${"a".repeat(33)}`, GITHUB_REPOSITORY: "C3nHx/Netcatty" };

test("release branch derives the configured official version and fork patch", () => {
  const result = resolveVersion(config, { ...env, GITHUB_REF: "refs/heads/release/windows-v1.1.85-c3nhx.1" });
  assert.equal(result.tag, "v1.1.85-c3nhx.1");
  assert.equal(result.version, "1.1.85-c3nhx.1");
  assert.equal(result.publish, "true");
  assert.equal(result.upstream_commit, config.upstreamCommit);
});

test("tag and manual publishing resolve the same version", () => {
  for (const options of [
    { GITHUB_REF: "refs/tags/v1.1.85-c3nhx.1" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", PUBLISH_RELEASE: "true" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", PUBLISH_RELEASE: "true", RELEASE_TAG: "v1.1.85-c3nhx.1" },
  ]) {
    const result = resolveVersion(config, { ...env, ...options });
    assert.equal(result.version, "1.1.85-c3nhx.1");
    assert.equal(result.publish, "true");
  }
});

test("ordinary builds carry the baseline, fork patch and safe source identifier without publishing", () => {
  for (const options of [{}, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "workflow_dispatch", PUBLISH_RELEASE: "false" }]) {
    const result = resolveVersion(config, { ...env, ...options });
    assert.equal(result.version, "1.1.85-c3nhx.1.dev.sha0000001");
    assert.equal(result.tag, "");
    assert.equal(result.publish, "false");
  }
});

test("official tags, stale branch revisions and mismatched baselines cannot publish", () => {
  for (const ref of ["refs/tags/v1.1.85", "refs/tags/v1.1.85-c3nhx.2", "refs/tags/v1.1.84-c3nhx.1", "refs/heads/release/windows-v1.1.85", "refs/heads/release/windows-v1.1.85-c3nhx.0"]) {
    assert.throws(() => resolveVersion(config, { ...env, GITHUB_REF: ref }), /must match fork-release.json/);
  }
  assert.throws(() => resolveVersion(config, { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", PUBLISH_RELEASE: "true", RELEASE_TAG: "v1.1.85" }), /must match/);
});

test("publication is confined to this fork", () => {
  assert.throws(() => resolveVersion(config, { ...env, GITHUB_REF: "refs/tags/v1.1.85-c3nhx.1", GITHUB_REPOSITORY: "binaricat/Netcatty" }), /restricted/);
});

test("invalid release configurations fail before writing any version", () => {
  for (const options of [{ patch: 0 }, { patch: -1 }, { patch: 1.5 }, { patch: "1" }, { upstreamVersion: "1.1.085" }, { upstreamVersion: "1.1.85-rc.1" }, { upstreamCommit: "main" }]) {
    assert.throws(() => resolveVersion({ ...config, ...options }, env), /requires an official version/);
  }
});

test("version assignment updates package, lockfile root and Actions outputs together", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "fork-release.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "netcatty", version: "0.0.0" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ version: "0.0.0", packages: { "": { version: "0.0.0" }, "node_modules/example": { version: "9.0.0" } } }));
  const output = path.join(root, "output");
  setVersion(root, { ...env, GITHUB_REF: "refs/tags/v1.1.85-c3nhx.1", GITHUB_OUTPUT: output });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, "1.1.85-c3nhx.1");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
  assert.equal(lock.version, "1.1.85-c3nhx.1");
  assert.equal(lock.packages[""].version, lock.version);
  assert.equal(lock.packages["node_modules/example"].version, "9.0.0");
  assert.match(fs.readFileSync(output, "utf8"), /^tag=v1\.1\.85-c3nhx\.1\nversion=1\.1\.85-c3nhx\.1\npublish=true\n/);
});
