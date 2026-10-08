const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowsDir = path.join(__dirname, "..", ".github", "workflows");
const readWorkflow = (name) => fs.readFileSync(path.join(workflowsDir, name), "utf8");

const testWorkflow = readWorkflow("test.yml");
const buildWorkflow = readWorkflow("build.yml");
const aiWorkflow = readWorkflow("ai-automation.yml");
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

test("package validation uses explicit releases and scopes PR builds", () => {
  assert.match(buildWorkflow, /push:\s*\n\s*tags:/);
  assert.doesNotMatch(buildWorkflow, /push:\s*\n\s*branches:/);
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
  assert.ok(buildWorkflow.includes('"$GITHUB_REPOSITORY" != C3nHx/Netcatty'));
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

test("Codex fix publishing treats a moved PR head as a stale result", () => {
  const publishJob = aiWorkflow.match(/\n  publish_codex_fix:\n[\s\S]*?(?=\n  own_rerequest_codex:)/);
  assert.ok(publishJob, "publish_codex_fix job must exist before own_rerequest_codex");
  assert.match(publishJob[0], /--force-with-lease/);
  assert.match(publishJob[0], /published=false/);
  assert.match(publishJob[0], /remote_after/);
  assert.match(publishJob[0], /exit 1/);
  assert.match(publishJob[0], /steps\.publish\.outputs\.published == 'true'/);
});

test("issue implementation publishing tolerates competing automation runs", () => {
  const publishJob = aiWorkflow.match(/\n  publish_implement:\n[\s\S]*?(?=\n  codex_loop:)/);
  assert.ok(publishJob, "publish_implement job must exist before codex_loop");
  assert.match(publishJob[0], /--force-with-lease/);
  assert.match(publishJob[0], /candidate_tree/);
  assert.match(publishJob[0], /remote_tree/);
  assert.match(publishJob[0], /refs\/heads\/\$\{BRANCH\}:/);
  assert.match(publishJob[0], /fetch --depth=1 origin[\s\\]*"\+refs\/heads\/\$\{BRANCH\}:refs\/remotes\/origin\/\$\{BRANCH\}"/);
  assert.match(publishJob[0], /live_after/);
  assert.match(publishJob[0], /changed while it was being checked/);
  assert.match(publishJob[0], /reuse it without rewriting history/);
  assert.doesNotMatch(publishJob[0], /:\$\{expected\}/);
  assert.doesNotMatch(publishJob[0], /if \[\[ -n "\$expected" \]\]/);
  assert.doesNotMatch(publishJob[0], /published=false/);
  assert.match(publishJob[0], /remote_after/);
  assert.match(publishJob[0], /exit 1/);
  assert.match(publishJob[0], /echo "handoff=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(
    publishJob[0],
    /if: failure\(\) && steps\.existing\.outputs\.exists != 'true' && steps\.publish\.outputs\.handoff == 'true'/,
  );
  assert.doesNotMatch(publishJob[0], /steps\.publish\.outcome == 'failure'/);
  assert.match(publishJob[0], /labels: \['ready-for-human'\]/);
  assert.match(publishJob[0], /could not safely publish the implementation branch/);
  assert.match(publishJob[0], /ai-publish-handoff:/);
  assert.match(publishJob[0], /github\.paginate\(github\.rest\.issues\.listComments/);
  assert.match(publishJob[0], /steps\.publish\.outputs\.published == 'true'/);
  assert.match(publishJob[0], /group: ai-codex-head-/);
  assert.match(publishJob[0], /status === 403 && createPermissionDenied/);
  assert.match(publishJob[0], /resource not accessible by integration/);
  assert.match(publishJob[0], /resource not accessible by personal access token/);
  assert.match(publishJob[0], /not permitted to create/);
});

test("reused automation PRs still receive labels and one source-issue backlink", () => {
  const openPr = aiWorkflow.match(
    /\n      - name: Open draft PR[\s\S]*?(?=\n      - name: Request Codex review on implement PR)/,
  );
  assert.ok(openPr, "open-PR step must exist before Codex review request");
  assert.match(openPr[0], /github\.rest\.issues\.addLabels/);
  assert.match(openPr[0], /github\.paginate\(github\.rest\.issues\.listComments/);
  assert.match(openPr[0], /auto\.hasAutomationPullRequestBacklink/);
  assert.doesNotMatch(openPr[0], /if \(created\)/);
});

test("reused implementation PRs do not duplicate Codex requests for the same head", () => {
  const requestCodex = aiWorkflow.match(
    /\n      - name: Request Codex review on implement PR[\s\S]*?(?=\n  codex_loop:)/,
  );
  assert.ok(requestCodex, "implement Codex request step must exist before codex_loop");
  assert.match(requestCodex[0], /github\.paginate\(github\.rest\.issues\.listComments/);
  assert.match(requestCodex[0], /github\.rest\.pulls\.get/);
  assert.match(requestCodex[0], /auto\.shouldSkipExternalCodexRerequest/);
  assert.match(requestCodex[0], /headSha/);
  assert.match(requestCodex[0], /OWN_ACTORS/);
  assert.doesNotMatch(requestCodex[0], /process\.env\.HEAD_SHA/);
});

test("all own-PR Codex request paths serialize on the head branch", () => {
  const codexLoop = aiWorkflow.match(/\n  codex_loop:\n[\s\S]*?(?=\n  publish_codex_fix:)/);
  const ownRerequest = aiWorkflow.match(/\n  own_rerequest_codex:\n[\s\S]*?(?=\n  external_rerequest_codex:)/);
  assert.ok(codexLoop, "codex_loop job must exist before publish_codex_fix");
  assert.ok(ownRerequest, "own_rerequest_codex must exist before external_rerequest_codex");
  assert.match(aiWorkflow, /head_ref: \$\{\{ steps\.decide\.outputs\.head_ref \}\}/);
  assert.match(codexLoop[0], /group: ai-codex-head-/);
  assert.match(ownRerequest[0], /group: ai-codex-head-/);
  assert.match(codexLoop[0], /needs\.route\.outputs\.head_ref/);
  assert.match(ownRerequest[0], /needs\.route\.outputs\.head_ref/);
  assert.match(aiWorkflow, /head_ref: pr\.head\?\.ref \|\| ''/);
  assert.match(
    aiWorkflow,
    /issue_comment[\s\S]*?github\.rest\.pulls\.get[\s\S]*?head_ref: pr\.head\?\.ref \|\| ''/,
  );
});

test("scheduled Codex polling ignores review comments remapped from old heads", () => {
  const pollJob = aiWorkflow.match(/\n  codex_poll:\n[\s\S]*$/);
  assert.ok(pollJob, "codex_poll job must exist");
  assert.match(pollJob[0], /auto\.filterCodexReviewCommentsForHead\(\s*reviewComments,\s*pr\.head\.sha/);
  assert.doesNotMatch(pollJob[0], /c\.commit_id \|\| c\.original_commit_id/);
});

test("clean Codex handoff updates labels without GraphQL-only organization scopes", () => {
  const markReady = aiWorkflow.match(/\n      - name: Mark PR ready after clean Codex[\s\S]*?(?=\n      - name: Give up after max rounds)/);
  assert.ok(markReady, "mark-ready step must exist before give-up step");
  assert.match(markReady[0], /gh api/);
  assert.match(markReady[0], /issues\/\$\{PULL_NUMBER\}\/labels/);
  assert.match(markReady[0], /automation%3Acodex-loop/);
  assert.match(markReady[0], /ready-for-human/);
  assert.match(markReady[0], /labels\[\]=automation:codex-clean/);
  assert.match(markReady[0], /labels\[\]=automation:bot-pr/);
  assert.doesNotMatch(markReady[0], /nextCodexTerminalLabels/);
  assert.doesNotMatch(markReady[0], /"PUT"/);
  assert.doesNotMatch(markReady[0], /gh pr edit/);
});

test("permission handoffs use the established ready-for-human label", () => {
  assert.doesNotMatch(aiWorkflow, /automation:needs-human/);
  assert.match(aiWorkflow, /labels: \['ready-for-human'\]/);
  assert.match(aiWorkflow, /-f 'labels\[\]=ready-for-human'/);
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
