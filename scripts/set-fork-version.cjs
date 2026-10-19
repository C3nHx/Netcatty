const fs = require("node:fs");
const path = require("node:path");

const CORE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_BRANCH = "refs/heads/release/windows-";

function resolveVersion(config, env) {
  if (!CORE_VERSION.test(config.upstreamVersion) ||
      !Number.isSafeInteger(config.patch) || config.patch < 1 ||
      !/^[a-f0-9]{40}$/.test(config.upstreamCommit)) {
    throw new Error("fork-release.json requires an official version, commit SHA, and positive patch number");
  }
  const releaseVersion = `${config.upstreamVersion}-c3nhx.${config.patch}`;
  const expectedTag = `v${releaseVersion}`;
  const ref = env.GITHUB_REF || "";
  let tag = "";
  let publish = false;
  if (ref.startsWith("refs/tags/")) {
    tag = ref.slice("refs/tags/".length);
    publish = env.GITHUB_EVENT_NAME === "push" || env.PUBLISH_RELEASE === "true";
  } else if (env.GITHUB_EVENT_NAME === "push" && ref.startsWith(RELEASE_BRANCH)) {
    tag = ref.slice(RELEASE_BRANCH.length);
    publish = true;
  } else if (env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.PUBLISH_RELEASE === "true") {
    tag = env.RELEASE_TAG || expectedTag;
    publish = true;
  }
  if (tag && tag !== expectedTag) {
    throw new Error(`Release tag must match fork-release.json: ${expectedTag}; received ${tag}`);
  }
  if (publish && env.GITHUB_REPOSITORY !== "C3nHx/Netcatty") {
    throw new Error("Release publishing is restricted to C3nHx/Netcatty");
  }
  const sha = env.GITHUB_SHA || "local";
  if (!/^(?:[a-f0-9]{7,40}|local)$/.test(sha)) throw new Error("Invalid source SHA");
  return {
    tag,
    version: tag ? releaseVersion : `${releaseVersion}.dev.sha${sha.slice(0, 7)}`,
    publish: String(publish),
    upstream_version: config.upstreamVersion,
    upstream_commit: config.upstreamCommit,
    patch: String(config.patch),
  };
}

function setVersion(projectDir, env) {
  const config = JSON.parse(fs.readFileSync(path.join(projectDir, "fork-release.json"), "utf8"));
  const result = resolveVersion(config, env);
  for (const name of ["package.json", "package-lock.json"]) {
    const file = path.join(projectDir, name);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.version = result.version;
    if (data.packages?.[""]) data.packages[""].version = result.version;
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  return result;
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(setVersion(path.resolve(__dirname, ".."), process.env)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveVersion, setVersion };
