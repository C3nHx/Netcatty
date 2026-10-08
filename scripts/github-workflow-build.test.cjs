const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const buildWorkflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "build.yml"),
  "utf8",
);
const etLinuxScript = fs.readFileSync(path.join(__dirname, "build-et", "build-linux.sh"), "utf8");
const etMacScript = fs.readFileSync(path.join(__dirname, "build-et", "build-macos.sh"), "utf8");

test("build workflow no longer installs removed legacy agent binaries", () => {
  for (const stale of [
    "@agentclientprotocol/claude-agent-acp",
    "@agentclientprotocol/sdk",
    "@zed-industries/codex-acp",
    "codex-acp",
  ]) {
    assert.equal(
      buildWorkflow.includes(stale),
      false,
      `build workflow must not reference removed legacy package: ${stale}`,
    );
  }
});

test("package workflow builds only Windows and retains native/runtime checks", () => {
  const jobs = [...buildWorkflow.matchAll(/^  ([\w-]+):\n    name:/gm)].map((match) => match[1]);
  assert.deepEqual(jobs, ["build", "release"]);
  assert.match(buildWorkflow, /name: build-windows\s*\n\s*runs-on: windows-latest/);
  assert.doesNotMatch(buildWorkflow, /matrix:|macos-latest|build-linux|pack:mac|pack:linux/);
  assert.match(buildWorkflow, /run: npm run pack:win-x64/);
  assert.match(buildWorkflow, /Compile ConPTY test helpers/);
  assert.match(buildWorkflow, /Test Mosh handshake through ConPTY/);
  assert.match(buildWorkflow, /Verify packaged ConPTY threshold/);
  assert.match(buildWorkflow, /Test tray panel layout at 200% scale on Windows/);
});

test("Windows artifacts and Release uploads contain only Windows packages", () => {
  for (const extension of ["exe", "zip", "yml", "blockmap"]) {
    assert.ok(buildWorkflow.includes(`release/*.${extension}`));
    assert.ok(buildWorkflow.includes(`artifacts/*.${extension}`));
  }
  assert.match(buildWorkflow, /if-no-files-found: error/);
  assert.match(buildWorkflow, /fail_on_unmatched_files: true/);
  assert.match(buildWorkflow, /artifacts\/SHA256SUMS/);
  assert.doesNotMatch(buildWorkflow, /\*\.(?:dmg|deb|rpm|pacman|AppImage)/);
  assert.match(buildWorkflow, /ELECTRON_BUILDER_PUBLISH: "never"/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(pkg.scripts["pack:win-x64"], /--publish=never/);
});

test("build workflow initializes MSVC before Windows packaging", () => {
  assert.match(buildWorkflow, /name: Set up MSVC developer command prompt\s*\n\s*uses: ilammy\/msvc-dev-cmd@v1\s*\n\s*with:\s*\n\s*arch: x64/);
  assert.ok(buildWorkflow.indexOf("Set up MSVC developer command prompt") < buildWorkflow.indexOf("name: Install deps"));
});

test("Windows release downloads terminal clients without publishing upstream", () => {
  const bundle = buildWorkflow.match(/- name: Bundle Windows terminal clients[\s\S]*?(?=\n      - name: Build package)/)?.[0];
  assert.ok(bundle);
  assert.match(bundle, /ET_BIN_OWNER: binaricat/);
  assert.match(bundle, /ET_BIN_REPO: Netcatty-et-bin/);
  assert.match(bundle, /MOSH_BIN_OWNER: binaricat/);
  assert.match(bundle, /--platform=win32 --arch=x64 --resolve-release/g);
});

test("et binary build scripts retry dependency configure and pin ninja", () => {
  for (const [name, script] of [
    ["linux", etLinuxScript],
    ["macos", etMacScript],
  ]) {
    assert.match(script, /retry_command\(\)/, `${name} et build must retry transient dependency failures`);
    assert.match(script, /retry_command cmake -S/, `${name} et build must retry CMake configure`);
    assert.match(script, /NINJA_BIN=\$\(command -v ninja\)/, `${name} et build must resolve ninja before configure`);
    assert.match(script, /-DCMAKE_MAKE_PROGRAM="\$NINJA_BIN"/, `${name} et build must pass the resolved ninja path`);
  }
});
