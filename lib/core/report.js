function buildReport({
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
}) {
  const statusLabel = sensitive.length
    ? "⚠️ Sensitive files detected"
    : adjustedScore <= 50
      ? "⚠️ Review recommended"
      : "✅ No major red flags";

  const conflictLines = overlaps.length
    ? overlaps
        .map((p) => `- PR #${p.number} “${p.title}” (Edited **${p.overlap}** same files)`)
        .join("\n")
    : "- None detected from open PRs";

  const nextStepsParts = [];
  if (sensitive.length)
    nextStepsParts.push("Remove flagged files and add them to `.gitignore`; re-run CI");
  if (overlaps.length) nextStepsParts.push("Review overlaps with referenced PRs");
  const nextSteps = nextStepsParts.length ? `> Next Steps — ${nextStepsParts.join("; ")}` : null;

  const conflictsBlock = overlaps.length
    ? [
        "> [!WARNING]",
        "> Possible Conflicts:",
        ...conflictLines.split("\n").map((line) => `> ${line}`),
      ].join("\n")
    : null;

  const sensitiveBlock = sensitive.length
    ? [
        "> [!IMPORTANT]",
        "> Sensitive Artifacts:",
        ...sensitive.map(
          (s) =>
            `> - ${s.status} \`${s.file}\` (Pattern: \`${s.pattern}\`, Reason: \`${s.reason || "sensitive artifact"}\`)`,
        ),
        ">      - Please remove sensitive files and add them to `.gitignore` before merging.",
        "> ",
        "> Patterns from \`dangerous-patterns.yml\` (override with \`DANGEROUS_PATTERNS_FILE\`).",
      ].join("\n")
    : null;

  const busSeverity =
    own.busFactor <= 1
      ? "🚨 Low redundancy"
      : own.busFactor === 2
        ? "⚠️ Moderate coverage"
        : "✅ Shared knowledge";

  const md = [
    `## Report: #${prNumber}, Commits: ${commits.length} — Score: **${adjustedScore}%**`,
    "",
    "| Metric  | Result |",
    "| ------------- | ------------- |",
    `| Risk Assessment  | ${adjustedScore >= 80 ? "🟢 Low" : adjustedScore >= 50 ? "🟠 Medium" : "🔴 High"} |`,
    `| Fatigue  | ${state.fatigue ? `⚠️ Fatigue detected (**${state.lateWeek}** late-night commits in last 7 days)` : `✅ No fatigue detected (late-night commits last 7d: **${state.lateWeek}**)`} |`,
    `| Risky Files | ${br.risky > 0 ? `⚠️ ${br.risky}` : "✅ 0"} |`,
    hasTests ? `| Tests Touched | ${safety.testsTouched ? "✅ Yes" : "⚠️ No"} |` : null,
    `| Status | ${statusLabel} |`,
    `| Changes | \`${br.filesChanged}\` files (\`+${additions}\`) / (\`-${deletions}\`) |`,
    `| Affects | ${domainSummary} |`,
    "",
    conflictsBlock,
    conflictsBlock ? "" : null,
    sensitiveBlock,
    sensitiveBlock ? "" : null,
    nextSteps,
    nextSteps ? "" : null,
    "> [!TIP]",
    `> Contributors: ${mentions.map((c) => `\`${c}\``).join(", ")} | Bus factor: **${own.busFactor}** (${busSeverity})`,
    "",
    `Created with [Voyrox/Nightwatch](https://github.com/Voyrox/Nightwatch) version ${version}`,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join("\n");

  return md;
}

module.exports = { buildReport };
