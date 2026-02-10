const { sh } = require("./shell");
const { domainFromFile, isRisky, isTestFile, isPublicSurface } = require("./classifiers");
const { nowSydneyHour } = require("./time");

function DeveloperStateFromGit() {
  const raw = sh(`git log -n 50 --pretty=%ct`).trim().split("\n").filter(Boolean).map(Number);
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const lateWeek = raw
    .filter((t) => t >= weekAgo)
    .filter((t) => {
      const h = nowSydneyHour(t);
      return h >= 0 && h < 5;
    });

  const fatigue = lateWeek.length >= 3;
  return {
    focused: true,
    fatigue,
    lateWeek: lateWeek.length,
  };
}

function ownershipFingerprint(files) {
  const since = "180.days";
  const counts = new Map();

  for (const f of files) {
    let out = "";
    try {
      out = sh(`git log --since=${since} --format=%an -- "${f}"`).trim();
    } catch {
      continue;
    }
    if (!out) continue;
    for (const name of out.split("\n").filter(Boolean)) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0) || 1;

  const topShare = sorted.length ? sorted[0][1] / total : 0;
  let bus = 1;
  if (topShare <= 0.6) {
    const top2 = (sorted[0]?.[1] || 0) + (sorted[1]?.[1] || 0);
    bus = top2 / total > 0.75 ? 2 : 3;
  }

  return {
    contributors: sorted.slice(0, 8).map(([n]) => n),
    newContributor: null,
    busFactor: bus,
    topShare,
  };
}

function contributorMentions(contributors, commits) {
  const nameToLogin = new Map();
  for (const c of commits) {
    const login = c.author?.login;
    const name = c.commit?.author?.name;
    if (login && name) {
      nameToLogin.set(name.toLowerCase(), `@${login}`);
    }
  }

  const mentions = [];
  for (const c of contributors) {
    const mention = nameToLogin.get(c.toLowerCase()) || c;
    if (!mentions.includes(mention)) mentions.push(mention);
  }
  return mentions;
}

function refactorSafety(files, additions, deletions) {
  let score = 100;

  const filesChanged = files.length;
  score -= Math.min(40, filesChanged * 1);

  const riskyFiles = files.filter(isRisky).length;
  score -= Math.min(30, riskyFiles * 6);

  const publicTouched = files.some(isPublicSurface);
  if (publicTouched) score -= 15;

  const testsTouched = files.some(isTestFile);
  if (testsTouched) score += 10;
  else score -= 10;

  const churn = additions + deletions;
  score -= Math.min(20, Math.floor(churn / 500) * 5);

  score = Math.max(0, Math.min(100, score));
  return { score, testsTouched, publicTouched };
}

function blastRadius(files) {
  const dom = new Map();
  for (const f of files) {
    const d = domainFromFile(f);
    dom.set(d, (dom.get(d) || 0) + 1);
  }
  const affectsEntries = [...dom.entries()].sort((a, b) => b[1] - a[1]);
  const affects = affectsEntries.map(([d]) => d);
  const affectsWithCounts = affectsEntries.map(([d, count]) => ({
    name: d,
    count,
    label: `${d.charAt(0).toUpperCase()}${d.slice(1)}`,
  }));
  const risky = files.filter(isRisky).length;
  return {
    affects: affects.slice(0, 6),
    affectsWithCounts: affectsWithCounts.slice(0, 6),
    risky,
    filesChanged: files.length,
  };
}

function diffStats(baseRef) {
  const target = baseRef || "main";
  const files = sh(`git diff --name-only origin/${target}...HEAD`)
    .trim()
    .split("\n")
    .filter(Boolean);
  let additions = 0,
    deletions = 0;
  const numstat = sh(`git diff --numstat origin/${target}...HEAD`)
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const line of numstat) {
    const [a, d] = line.split("\t");
    additions += Number(a) || 0;
    deletions += Number(d) || 0;
  }
  return { files, additions, deletions };
}

module.exports = {
  DeveloperStateFromGit,
  ownershipFingerprint,
  contributorMentions,
  refactorSafety,
  blastRadius,
  diffStats,
};
