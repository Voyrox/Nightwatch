const { loadEnv } = require("./core/env");
const { ghFetch, prFilesAndConflicts, resolveVersion, upsertComment } = require("./core/github");
const { findSensitiveFiles } = require("./core/patterns");
const { domainFromFile, isTestFile } = require("./core/classifiers");
const {
  DeveloperStateFromGit,
  ownershipFingerprint,
  contributorMentions,
  refactorSafety,
  blastRadius,
  diffStats,
} = require("./core/analytics");
const { buildReport } = require("./core/report");
const { sh } = require("./core/shell");

(async () => {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const { GH, event, isPR, owner, repo, prNumber, baseRef } = env;
  if (!GH) {
    console.error("Missing GITHUB_TOKEN");
    process.exit(1);
  }

  const state = DeveloperStateFromGit();

  if (!isPR) {
    console.log(`Developer State: fatigue=${state.fatigue} lateWeek=${state.lateWeek}`);
    return;
  }

  const { files, overlaps } = await prFilesAndConflicts(prNumber);
  const commits = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=250`,
  );

  try {
    sh(`git fetch origin ${baseRef} --depth=1`);
  } catch {}
  const { additions, deletions } = diffStats(baseRef);

  const sensitive = findSensitiveFiles(baseRef, files);

  const br = blastRadius(files);
  const own = ownershipFingerprint(files);
  const mentions = contributorMentions(own.contributors, commits);
  const safety = refactorSafety(files, additions, deletions);
  const adjustedScore = Math.max(0, safety.score - (sensitive.length ? 10 : 0));

  const domainSummary =
    br.affectsWithCounts.map(({ label, count }) => `\`${label}\` (**${count}**)`).join(", ") ||
    "None";

  const hasTests = files.some(isTestFile);

  const version = resolveVersion(sh);

  const md = buildReport({
    prNumber,
    commits,
    adjustedScore,
    state,
    br,
    safety,
    additions,
    deletions,
    overlaps,
    sensitive,
    mentions,
    own,
    domainSummary,
    hasTests,
    version,
  });

  await upsertComment(prNumber, md);
  console.log("Posted/updated PR Nightwatch comment");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
