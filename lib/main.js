/* eslint-disable no-console */
const fs = require("fs");

const GH = process.env.GITHUB_TOKEN;
if (!GH) {
    console.error("Missing GITHUB_TOKEN");
    process.exit(1);
}

const eventPath = process.env.GITHUB_EVENT_PATH;
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

const isPR = !!event.pull_request;
const owner = event.repository.owner.login;
const repo = event.repository.name;

const sh = (cmd) => require("child_process").execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");

async function ghFetch(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: {
            "Authorization": `Bearer ${GH}`,
            "Accept": "application/vnd.github+json",
            ...(opts.headers || {}),
        },
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${txt}`);
    }
    return res.json();
}

const prFilesCache = new Map();

function domainFromFile(f) {
    const rules = [
        [/^lib\//, "ops"],
        [/^\.github\/workflows\//, "ci"],
        [/^\.github\//, "repo-meta"],
        [/^README\.md$/, "docs"],
    ];
    for (const [re, name] of rules) if (re.test(f)) return name;
    return "misc";
}

function isTestFile(f) {
    return /(^test\/|\/test\/|_test\.)/.test(f);
}

function isPublicSurface(f) {
    return /(^api\/|^proto\/|^schema\/|^public\/|^include\/|routes\/|openapi|swagger)/i.test(f);
}

function isRisky(f) {
    return /(auth|billing|payments?|migrations?|infra|terraform|k8s|docker|lock|schema|proto)/i.test(f);
}

function nowSydneyHour(tsSeconds) {
    const d = new Date(tsSeconds * 1000);
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: process.env.TZ || "Australia/Sydney", hour: "numeric", hour12: false }).formatToParts(d);
    const h = Number(parts.find(p => p.type === "hour")?.value ?? "0");
    return h;
}

function DeveloperStateFromGit() {
    // last 50 commits
    const raw = sh(`git log -n 50 --pretty=%ct`).trim().split("\n").filter(Boolean).map(Number);
    // last 7 days
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const lateWeek = raw.filter(t => t >= weekAgo).filter((t) => {
        const h = nowSydneyHour(t);
        return (h >= 0 && h < 5);
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
    if (topShare <= 0.60) {
        const top2 = (sorted[0]?.[1] || 0) + (sorted[1]?.[1] || 0);
        bus = (top2 / total > 0.75) ? 2 : 3;
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

function diffStats() {
    // Additions/deletions and files list
    const files = sh(`git diff --name-only origin/${event.pull_request?.base?.ref || "main"}...HEAD`).trim().split("\n").filter(Boolean);
    let additions = 0, deletions = 0;
    const numstat = sh(`git diff --numstat origin/${event.pull_request?.base?.ref || "main"}...HEAD`).trim().split("\n").filter(Boolean);
    for (const line of numstat) {
        const [a, d] = line.split("\t");
        additions += Number(a) || 0;
        deletions += Number(d) || 0;
    }
    return { files, additions, deletions };
}

async function prFilesAndConflicts(prNumber) {
    async function getFiles(n) {
        if (prFilesCache.has(n)) return prFilesCache.get(n);
        const fetched = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${n}/files?per_page=300`);
        const list = fetched.map(f => f.filename);
        prFilesCache.set(n, list);
        return list;
    }

    const files = await getFiles(prNumber);

    // Conflicts
    const openPRs = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
    const others = openPRs.filter(p => p.number !== prNumber);

    const overlaps = [];
    const fileSet = new Set(files);

    for (const p of others.slice(0, 30)) { // limit to 30 other PRs for performance;
        const otherFiles = await getFiles(p.number);
        const overlap = otherFiles.filter(x => fileSet.has(x));
        if (overlap.length) {
            overlaps.push({ number: p.number, title: p.title, overlap: overlap.length });
        }
    }
    overlaps.sort((a, b) => b.overlap - a.overlap);
    return { files, overlaps: overlaps.slice(0, 5) };
}

function blastRadius(files) {
    const dom = new Map();
    for (const f of files) {
        const d = domainFromFile(f);
        dom.set(d, (dom.get(d) || 0) + 1);
    }
    const affects = [...dom.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
    const risky = files.filter(isRisky).length;
    return { affects: affects.slice(0, 6), risky, filesChanged: files.length };
}

async function upsertComment(prNumber, body) {
    const comments = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`);
    const marker = "<!-- pr-nightwatch-report -->";
    const existing = comments.find(c => (c.body || "").includes(marker));

    const finalBody = `${marker}\n${body}`;

    if (existing) {
        await ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ body: finalBody }),
        });
    } else {
        await ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
            method: "POST",
            body: JSON.stringify({ body: finalBody }),
        });
    }
}

(async () => {
    const state = DeveloperStateFromGit();

    if (!isPR) {
        console.log(`Developer State: fatigue=${state.fatigue} lateWeek=${state.lateWeek}`);
        return;
    }

    const prNumber = event.pull_request.number;
    const { files, overlaps } = await prFilesAndConflicts(prNumber);
    const commits = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=250`);

    const baseRef = event.pull_request.base.ref;
    try { sh(`git fetch origin ${baseRef} --depth=1`); } catch { }
    const { additions, deletions } = diffStats();

    const br = blastRadius(files);
    const own = ownershipFingerprint(files);
    const mentions = contributorMentions(own.contributors, commits);
    const safety = refactorSafety(files, additions, deletions);

    const conflictLines = overlaps.length
        ? overlaps.map(p => `- PR #${p.number} “${p.title}” (edited **${p.overlap}** same files)`).join("\n")
        : `- None detected from open PRs`;

    const md = `
## Report #${prNumber} — Score: **${safety.score}%**

| Metric  | Result |
| ------------- | ------------- |
| Risk Assessment  | ${safety.score >= 80 ? "🟢 Low" : safety.score >= 50 ? "🟠 Medium" : "🔴 High"} |
| Fatigue  | ${state.fatigue ? `⚠️ Fatigue detected (**${state.lateWeek}** late-night commits in last 7 days)` : `✅ No fatigue signal (late-night commits last 7d: **${state.lateWeek}**)`} |
| Status | ${safety.score <= 50 ? "⚠️ Review recommended" : "✅ No major red flags"} |

### Blast Radius
- Affects: ${br.affects.map(a => `\`${a}\``).join(", ")}
- Changed files: **${br.filesChanged}**
- Risky files: **${br.risky}**

### Possible Conflicts
${conflictLines}

### Ownership Fingerprint (last 180d)
- Contributors: ${mentions.map(c => `\`${c}\``).join(", ")}
- Bus factor: **${own.busFactor}${own.busFactor === 1 ? " ⚠️" : ""}**
`.trim();

    await upsertComment(prNumber, md);
    console.log("Posted/updated PR Nightwatch comment");
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
