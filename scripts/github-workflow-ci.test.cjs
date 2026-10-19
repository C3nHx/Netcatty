const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowsDir = path.join(__dirname, "..", ".github", "workflows");
const readWorkflow = (name) => fs.readFileSync(path.join(workflowsDir, name), "utf8");

const testWorkflow = readWorkflow("test.yml");
const buildWorkflow = readWorkflow("build.yml");
const appBuilderPatch = fs.readFileSync(
  path.join(__dirname, "..", "patches", "app-builder-lib+26.15.2.patch"),
  "utf8",
);
const homebrewBump = fs.readFileSync(
  path.join(__dirname, "..", ".github", "scripts", "bump-homebrew-cask.sh"),
  "utf8",
);

const pullRequestPaths = buildWorkflow
  .match(/pull_request:\s*\n\s*paths:\s*\n((?:\s+- "[^"]+"\s*\n)+)/)?.[1]
  ?.match(/^\s+- "([^"]+)"$/gm)
  ?.map((line) => line.match(/^\s+- "([^"]+)"$/)?.[1])
  .filter(Boolean);

// Portable glob matcher for Node >=22 (path.matchesGlob only landed in 22.5).
const matchesGlob = (filePath, pattern) => {
  let regex = "^";
  for (let i = 0; i < pattern.length; ) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        regex += "(?:.*/)?";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
      continue;
    }
    if (pattern[i] === "*") {
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (pattern[i] === "?") {
      regex += "[^/]";
      i += 1;
      continue;
    }
    regex += pattern[i].replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    i += 1;
  }
  regex += "$";
  return new RegExp(regex).test(filePath);
};

const triggersPackageValidation = (filePath) => {
  assert.ok(pullRequestPaths, "package workflow pull_request paths must be readable");
  return pullRequestPaths.reduce((included, pattern) => {
    const excluded = pattern.startsWith("!");
    const glob = excluded ? pattern.slice(1) : pattern;
    return matchesGlob(filePath, glob) ? !excluded : included;
  }, false);
};

test("PR validation runs once per commit and includes a production build", () => {
  assert.match(testWorkflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.doesNotMatch(testWorkflow, /branches:\s*\n\s*- "\*\*"/);
  assert.match(testWorkflow, /name: lint-and-test\s*\n\s*runs-on: ubuntu-latest\s*\n\s*timeout-minutes: 20/);
  assert.match(testWorkflow, /sudo apt-get install -y fish xvfb/);
  assert.match(
    testWorkflow,
    /- name: Test terminal keyword highlight performance\s*\n\s*env:\s*\n\s*NETCATTY_TERMINAL_PERF_SHOW_WINDOW: "1"\s*\n\s*# GitHub-hosted runners do not configure Electron's SUID sandbox helper\.\s*\n\s*run: xvfb-run -a \.\/node_modules\/\.bin\/electron --no-sandbox scripts\/xterm-keyword-highlight-performance\.live\.test\.cjs/,
  );
  assert.match(testWorkflow, /- name: Build\s*\n\s*run: npm run build/);
  assert.doesNotMatch(testWorkflow, /\n  mosh-windows-conpty:/);
});

test("package release concurrency is isolated per tag", () => {
  assert.match(buildWorkflow, /format\('release-\{0\}', github\.ref_name\)/);
  assert.doesNotMatch(buildWorkflow, /&& 'release' \|\| github\.ref/);
});

test("manual package validations do not share push concurrency", () => {
  assert.match(
    buildWorkflow,
    /github\.event_name == 'workflow_dispatch' && format\('manual-\{0\}', github\.run_id\)/,
  );
  assert.ok(
    buildWorkflow.indexOf("format('release-{0}', github.ref_name)") <
      buildWorkflow.indexOf("format('manual-{0}', github.run_id)"),
    "publishing a tag manually must still share that tag's release group",
  );
});

test("package validation uses explicit fork release branches and scopes PR builds", () => {
  assert.match(buildWorkflow, /push:\s*\n\s*branches:\s*\n\s*- "release\/windows-v\*"\s*\n\s*tags:/);
  assert.doesNotMatch(buildWorkflow, /branches:\s*\n\s*- main/);
  assert.doesNotMatch(buildWorkflow, /branches:\s*\n\s*- "\*\*"/);
  assert.match(buildWorkflow, /pull_request:\s*\n\s*paths:/);
  assert.doesNotMatch(buildWorkflow, /\n  dedupe:/);
  assert.doesNotMatch(buildWorkflow, /\n  dedupe-result:/);
  for (const packagedInput of [
    "electron/**",
    "infrastructure/config/terminalFlowConstants.*",
    "public/icon*",
    "scripts/afterPackMacUuid.cjs",
    "scripts/beforePackCursorSdk.cjs",
    "scripts/nodePtyConptyPatch.cjs",
    "scripts/patch-xterm-macos-column-selection.cjs",
    "scripts/xterm-macos-column-selection.live.test.cjs",
    "scripts/linux/**",
    "skills/**",
  ]) {
    assert.ok(buildWorkflow.includes(`- "${packagedInput}"`), `${packagedInput} must trigger package validation`);
  }

  for (const excludedTestInput of [
    "!electron/**/*.test.*",
    "!electron/**/*.spec.*",
    "!electron/**/__tests__/**",
    "!electron/**/test/**",
    "!electron/**/tests/**",
    "!electron/**/example/**",
    "!electron/**/examples/**",
    "!electron/plugins/fixtures/**",
  ]) {
    assert.ok(buildWorkflow.includes(`- "${excludedTestInput}"`), `${excludedTestInput} must stay out of package validation`);
  }

  assert.ok(
    buildWorkflow.indexOf('- "electron/**"') < buildWorkflow.indexOf('- "!electron/**/*.test.*"'),
    "packaged Electron files must be included before test-only exclusions",
  );

  for (const packagedPath of [
    "electron/main.cjs",
    "electron/entitlements.mac.plist",
    "electron/bridges/terminalBridge.cjs",
    "electron/preload/api.cjs",
    "electron/shared/protocol.cjs",
    "electron/mcp/server.cjs",
    "electron/plugins/pluginManager.cjs",
    "scripts/linux/after-install.tpl",
  ]) {
    assert.equal(triggersPackageValidation(packagedPath), true, `${packagedPath} must trigger package validation`);
  }

  for (const testOnlyPath of [
    "electron/main.test.cjs",
    "electron/bridges/moshHandshake.test.cjs",
    "electron/plugins/pluginManager.test.cjs",
    "electron/plugins/fixtures/example/plugin.cjs",
  ]) {
    assert.equal(triggersPackageValidation(testOnlyPath), false, `${testOnlyPath} must not trigger package validation`);
  }
});

test("Windows packaging reuses its dependency install for the ConPTY smoke test", () => {
  const packageMatrix = buildWorkflow.match(/\n  build:\n[\s\S]*?(?=\n  release:)/);
  assert.ok(packageMatrix, "Windows build job must exist before release");
  assert.match(packageMatrix[0], /Compile ConPTY test helpers/);
  assert.match(packageMatrix[0], /Test Mosh handshake through ConPTY/);
  assert.match(packageMatrix[0], /runs-on: windows-latest/);
  assert.match(packageMatrix[0], /Restore Electron download cache/);
  assert.match(packageMatrix[0], /actions\/cache@v6/);
  assert.match(packageMatrix[0], /node electron\/bridges\/terminalBridge\.moshConpty\.integration\.cjs/);
});

test("package downloads use bounded retries and reusable caches", () => {
  assert.match(buildWorkflow, /NPM_CONFIG_FETCH_RETRIES: "4"/);
  assert.match(buildWorkflow, /NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: "1000"/);
  assert.match(buildWorkflow, /NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: "10000"/);
  assert.equal(
    (buildWorkflow.match(/restore-keys:\s*\|\s*\n\s*electron-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-/g) ?? [])
      .length,
    1,
    "the Windows job must reuse compatible Electron downloads after lockfile changes",
  );

});

test("Windows releases only publish to this repository", () => {
  const releaseJob = buildWorkflow.slice(buildWorkflow.indexOf("\n  release:\n"));
  assert.match(releaseJob, /needs: build/);
  assert.match(releaseJob, /if: needs\.build\.outputs\.publish == 'true'/);
  assert.ok(releaseJob.includes("repository: ${{ github.repository }}"));
  assert.ok(releaseJob.includes("token: ${{ github.token }}"));
  assert.ok(releaseJob.includes("target_commitish: ${{ github.sha }}"));
  const versionScript = fs.readFileSync(path.join(__dirname, "set-fork-version.cjs"), "utf8");
  assert.ok(versionScript.includes('env.GITHUB_REPOSITORY !== "C3nHx/Netcatty"'));
  assert.match(buildWorkflow, /permissions:\s*\n  contents: read/);
  assert.match(releaseJob, /permissions:\s*\n      contents: write/);
  assert.doesNotMatch(buildWorkflow, /RELEASE_TOKEN|HOMEBREW_TAP_TOKEN|TRIAGE_GITHUB_TOKEN/);
  assert.doesNotMatch(buildWorkflow, /homebrew-tap:|update-nix-release:|npm publish|bump-homebrew-cask/);
});

test("Homebrew tap updates retry push races without downgrading newer releases", () => {
  assert.match(homebrewBump, /MAX_PUSH_ATTEMPTS/);
  assert.match(homebrewBump, /version_is_newer/);
  assert.match(homebrewBump, /git fetch --depth=1 origin main/);
  assert.match(homebrewBump, /git switch -C main origin\/main/);
  assert.match(homebrewBump, /for \(\(attempt=1; attempt<=MAX_PUSH_ATTEMPTS; attempt\+\+\)\)/);
  assert.match(homebrewBump, /if version_is_newer "\$current_version" "\$VERSION"/);
  assert.match(homebrewBump, /if push_output="\$\(git push origin HEAD:main 2>&1\)"/);
  assert.match(homebrewBump, /grep -Eqi 'non-fast-forward\|fetch first' <<<"\$push_output"/);
  assert.doesNotMatch(homebrewBump, /2> >\(tee/);
  assert.match(homebrewBump, /Tap already has newer version/);
  assert.match(homebrewBump, /Push raced with another release/);
});

test("standalone ET publishing is removed from this Windows fork", () => {
  assert.equal(fs.existsSync(path.join(workflowsDir, "build-et-binaries.yml")), false);
  assert.doesNotMatch(buildWorkflow, /ET_BIN_RELEASE_TOKEN|release_repo:/);
  assert.match(buildWorkflow, /node scripts\/fetch-et-binaries\.cjs --platform=win32 --arch=x64 --resolve-release/);
});

test("GitHub-owned actions use current Node 24 releases", () => {
  const workflows = fs.readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => [name, readWorkflow(name)]);
  const expectedMajors = new Map([
    ["actions/checkout", "v7"],
    ["actions/setup-node", "v7"],
    ["actions/upload-artifact", "v7"],
    ["actions/download-artifact", "v8"],
    ["actions/github-script", "v9"],
    ["actions/cache", "v6"],
  ]);

  for (const [name, source] of workflows) {
    for (const [action, major] of expectedMajors) {
      const uses = [...source.matchAll(new RegExp(`${action.replace("/", "\\/")}@(v\\d+)`, "g"))];
      for (const match of uses) {
        assert.equal(match[1], major, `${name} must use ${action}@${major}`);
      }
    }
  }
});

test("electron-builder retries Fetch API server errors", () => {
  assert.match(appBuilderPatch, /e\?\.response\?\.status/);
  assert.match(appBuilderPatch, /responseStatus >= 500/);
});
