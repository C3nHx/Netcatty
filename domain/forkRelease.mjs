export const RELEASES_PAGE_URL = 'https://github.com/C3nHx/Netcatty/releases';
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/C3nHx/Netcatty/releases?per_page=100';
export const FORK_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-c3nhx\.([1-9]\d*)$/;

/** Compare SemVer core and prerelease identifiers; build metadata has no precedence. */
export function compareVersions(a, b) {
  const parse = (value) => {
    const [core, prerelease] = value.replace(/^v/i, '').split('+')[0].split(/-(.*)/s);
    return { core: core.split('.').map((part) => Number(part) || 0), pre: prerelease?.split('.') };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const difference = (left.core[i] || 0) - (right.core[i] || 0);
    if (difference) return Math.sign(difference);
  }
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX && numericY) return Math.sign(Number(x) - Number(y));
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** Select published C3nHx builds, including GitHub prereleases, by version rather than date. */
export function selectForkRelease(releases) {
  return releases.filter((release) => !release.draft && FORK_RELEASE_TAG.test(release.tag_name || ''))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] || null;
}
