const test = require("node:test");
const assert = require("node:assert/strict");
const helpers = import("../domain/forkRelease.mjs");

test("fork patch updates compare numerically and reset with each official baseline", async () => {
  const { compareVersions } = await helpers;
  for (const [newer, older] of [["1.1.85-c3nhx.10", "1.1.85-c3nhx.9"], ["1.1.86-c3nhx.1", "1.1.85-c3nhx.99"], ["1.1.85-c3nhx.1", "1.1.84"]]) {
    assert.equal(compareVersions(newer, older), 1);
    assert.equal(compareVersions(older, newer), -1);
  }
});

test("version precedence follows SemVer prerelease and build metadata rules", async () => {
  const { compareVersions } = await helpers;
  assert.equal(compareVersions("1.1.85", "1.1.85-c3nhx.1"), 1);
  assert.equal(compareVersions("v1.1.85-c3nhx.1", "1.1.85-c3nhx.1+build2"), 0);
  assert.equal(compareVersions("1.1.85-c3nhx.1.dev.sha0000001", "1.1.85-c3nhx.1"), 1);
  assert.equal(compareVersions("1.1.85-1", "1.1.85-c3nhx"), -1);
});

test("release selection includes fork prereleases but excludes drafts and other channels", async () => {
  const { selectForkRelease } = await helpers;
  const releases = [
    { tag_name: "v1.1.85-c3nhx.9", prerelease: true },
    { tag_name: "v9.9.9", draft: false },
    { tag_name: "v1.1.86-c3nhx.1", draft: true },
    { tag_name: "v1.1.85-c3nhx.11.dev.shaabcdef0", prerelease: true },
    { tag_name: "v1.1.85-c3nhx.10", prerelease: true },
    { tag_name: "v1.1.85-beta.12", prerelease: true },
    { tag_name: "v1.1.85-c3nhx.01", prerelease: true },
  ];
  assert.equal(selectForkRelease(releases).tag_name, "v1.1.85-c3nhx.10");
  assert.equal(selectForkRelease([{ tag_name: "v1.1.84" }]), null);
  assert.equal(selectForkRelease([]), null);
});

test("release API and download pages belong to the fork", async () => {
  const { GITHUB_RELEASES_API, RELEASES_PAGE_URL } = await helpers;
  assert.equal(GITHUB_RELEASES_API, "https://api.github.com/repos/C3nHx/Netcatty/releases?per_page=100");
  assert.equal(RELEASES_PAGE_URL, "https://github.com/C3nHx/Netcatty/releases");
});
