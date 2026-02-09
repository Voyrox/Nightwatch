/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

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
        [/^\.github\/workflows\//, "Workflows"],
        [/^\.github\//, "Repository Metadata"],
        [/^README\.md$/, "Documentation"],
    ];
    for (const [re, name] of rules) if (re.test(f)) return name;
    return "Primary Codebase";
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

function loadDangerousPatterns() {
    const defaults = {
        banned: [
            { pattern: /^\.env$/i, reason: "Dotenv file" },
            { pattern: /^\.env\..+$/i, reason: "Dotenv file" },
            { pattern: /secrets?/i, reason: "Contains secrets" },
            { pattern: /credentials?/i, reason: "Contains credentials" },
            { pattern: /\.pem$/i, reason: "Private key" },
            { pattern: /\.key$/i, reason: "Private key" },
            { pattern: /\.p12$/i, reason: "Private key" },
            { pattern: /\.pfx$/i, reason: "Private key" },
            { pattern: /\.crt$/i, reason: "Certificate" },
            { pattern: /\.csr$/i, reason: "Certificate" },
            { pattern: /\.der$/i, reason: "Certificate" },
            { pattern: /\.jks$/i, reason: "Keystore" },
            { pattern: /\.p8$/i, reason: "Private key" },
            { pattern: /id_rsa/i, reason: "SSH private key" },
            { pattern: /serviceAccountKey\.json$/i, reason: "Cloud credentials" },
            { pattern: /google-services\.json$/i, reason: "Mobile app credentials" },
            { pattern: /GoogleService-Info\.plist$/i, reason: "Mobile app credentials" },
            { pattern: /\.aws\/credentials$/i, reason: "Cloud credentials" },
            { pattern: /\.npmrc$/i, reason: "Registry credentials" },
            { pattern: /\.pypirc$/i, reason: "Registry credentials" },
            { pattern: /\.firebase\//i, reason: "Cloud credentials" },
            { pattern: /\.supabase\//i, reason: "Cloud credentials" },
            { pattern: /\.expo\//i, reason: "App credentials" },
            { pattern: /\.gradle\//i, reason: "Build secrets" },
            { pattern: /\.keystore$/i, reason: "Keystore" },
            { pattern: /terraform\.tfvars$/i, reason: "Terraform secrets" },
            { pattern: /docker-compose\.override\.ya?ml$/i, reason: "Service credentials" },
            { pattern: /config\/.*secret.*/i, reason: "Secrets in config" },
            { pattern: /\.sqlite$/i, reason: "Local database" },
            { pattern: /\.db$/i, reason: "Local database" },
            { pattern: /\.log$/i, reason: "Log output" },
            { pattern: /\.ipynb_checkpoints\//i, reason: "Notebook checkpoint" },
            { pattern: /\.vscode\/settings\.json$/i, reason: "IDE settings" },
            { pattern: /\.idea\//i, reason: "IDE settings" },
            { pattern: /node_modules\//i, reason: "Vendored dependencies" },
            { pattern: /venv\//i, reason: "Virtualenv" },
            { pattern: /coverage\//i, reason: "Coverage output" },
            { pattern: /\.nyc_output\//i, reason: "Coverage output" },
            { pattern: /dist\//i, reason: "Build output" },
            { pattern: /Thumbs\.db$/i, reason: "OS artifact" },
            { pattern: /\.DS_Store$/i, reason: "OS artifact" },
        ],
        allowed: [
            /^\.env\.example$/i,
            /\.example$/i,
            /sample/i,
            /fixtures?/i,
            /test-data/i,
        ],
    };

    const cfgPath = process.env.DANGEROUS_PATTERNS_FILE || path.join(process.cwd(), "dangerous-patterns.yml");
    let userCfg = null;
    try {
        const raw = fs.readFileSync(cfgPath, "utf8");
        userCfg = parseSimpleYaml(raw);
    } catch {
        // ignore missing/parse errors; fall back to defaults
    }

    const banned = normalizeBanned(userCfg?.banned).filter(Boolean);
    const allowed = normalizeAllowed(userCfg?.allowed).filter(Boolean);

    return {
        banned: banned.length ? banned : defaults.banned,
        allowed: allowed.length ? allowed : defaults.allowed,
    };
}

function normalizeBanned(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
        if (item && typeof item === "object" && item.pattern) {
            const re = toRegex(item.pattern);
            return re ? { pattern: re, reason: item.reason || null } : null;
        }
        const re = toRegex(item);
        return re ? { pattern: re, reason: null } : null;
    }).filter(Boolean);
}

function normalizeAllowed(list) {
    if (!Array.isArray(list)) return [];
    return list.map(toRegex).filter(Boolean);
}

function toRegex(val) {
    if (val instanceof RegExp) return val;
    if (typeof val !== "string") return null;
    try {
        return new RegExp(val, "i");
    } catch {
        return null;
    }
}

function parseSimpleYaml(src) {
    const out = { banned: [], allowed: [] };
    let current = null;
    let lastEntry = null;

    for (const line of src.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;

        if (!line.startsWith(" ") && !line.startsWith("\t") && line.trim().endsWith(":")) {
            const key = line.trim().slice(0, -1).trim();
            current = (key === "banned" || key === "allowed") ? key : null;
            lastEntry = null;
            continue;
        }

        if (!current) continue;

        const trimmed = line.trim();

        const patternMatch = trimmed.match(/^-\s+pattern:\s*(.+)$/);
        if (patternMatch) {
            const entry = { pattern: patternMatch[1].trim() };
            out[current].push(entry);
            lastEntry = entry;
            continue;
        }

        if (trimmed.startsWith("-")) {
            const val = trimmed.slice(1).trim();
            if (val) out[current].push(val);
            lastEntry = null;
            continue;
        }

        const reasonMatch = trimmed.match(/^reason:\s*(.+)$/i);
        if (reasonMatch && lastEntry) {
            lastEntry.reason = reasonMatch[1].trim();
            continue;
        }
    }
    return out;
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

function findSensitiveFiles(baseRef, files) {
    const cfg = loadDangerousPatterns();
    let statusLines = [];
    try {
        statusLines = sh(`git diff --name-status origin/${baseRef}...HEAD`).trim().split("\n").filter(Boolean);
    } catch {
        statusLines = [];
    }

    const statusMap = new Map();
    for (const line of statusLines) {
        const [st, file] = line.split(/\s+/, 2);
        if (st && file) statusMap.set(file, st);
    }

    const matches = [];
    const check = (file) => {
        const isAllowed = cfg.allowed.some((re) => re.test(file));
        if (isAllowed) return;
        const hit = cfg.banned.find((b) => b.pattern.test(file));
        if (hit) {
            matches.push({
                file,
                status: statusMap.get(file) || "M",
                pattern: hit.pattern.toString(),
                reason: hit.reason || reasonForSensitive(file, hit.pattern),
            });
        }
    };

    for (const f of files) check(f);
    return matches;
}

function reasonForSensitive(file, re) {
    const lower = file.toLowerCase();
    if (/\.pem$|\.key$|\.p12$|\.pfx$|\.p8$/.test(lower)) return "private key";
    if (/id_rsa/.test(lower)) return "ssh private key";
    if (/google-services|serviceaccount/.test(lower)) return "cloud credentials";
    if (/\.aws\//.test(lower) || /credentials/.test(lower)) return "credentials";
    if (/\.env/.test(lower)) return "dotenv secrets";
    if (/\.db$|\.sqlite$/.test(lower)) return "database dump";
    if (/\.log$/.test(lower)) return "log output";
    if (/node_modules\//.test(lower)) return "vendored dependencies";
    if (/dist\//.test(lower)) return "build output";
    if (/\.vscode|\.idea/.test(lower)) return "IDE settings";
    if (/coverage|nyc_output/.test(lower)) return "coverage output";
    if (/thumbs\.db|\.ds_store/.test(lower)) return "OS artifact";
    if (/tfvars/.test(lower)) return "terraform secrets";
    if (/docker-compose\.override/.test(lower)) return "service credentials";
    return `sensitive (${re.toString()})`;
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
    const affectsEntries = [...dom.entries()].sort((a, b) => b[1] - a[1]);
    const affects = affectsEntries.map(([d]) => d);
    const affectsWithCounts = affectsEntries.map(([d, count]) => ({
        name: d,
        count,
        label: `${d.charAt(0).toUpperCase()}${d.slice(1)}`,
    }));
    const risky = files.filter(isRisky).length;
    return { affects: affects.slice(0, 6), affectsWithCounts: affectsWithCounts.slice(0, 6), risky, filesChanged: files.length };
}

function resolveVersion() {
    try {
        const tag = sh(`git describe --tags --abbrev=0`).trim();
        if (tag) return tag;
    } catch {
        // fall through
    }
    return "v1.0.0";
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

    const sensitive = findSensitiveFiles(baseRef, files);

    const br = blastRadius(files);
    const own = ownershipFingerprint(files);
    const mentions = contributorMentions(own.contributors, commits);
    const safety = refactorSafety(files, additions, deletions);
    const adjustedScore = Math.max(0, safety.score - (sensitive.length ? 10 : 0));

    const statusLabel = sensitive.length
        ? "⚠️ Sensitive files detected"
        : (adjustedScore <= 50 ? "⚠️ Review recommended" : "✅ No major red flags");

    const conflictLines = overlaps.length
        ? overlaps.map(p => `- PR #${p.number} “${p.title}” (Edited **${p.overlap}** same files)`).join("\n")
        : `- None detected from open PRs`;

    const domainSummary = br.affectsWithCounts
        .map(({ label, count }) => `\`${label}\` (**${count}**)`)
        .join(", ") || "None";

    const nextStepsParts = [];
    if (sensitive.length) nextStepsParts.push("Remove flagged files and add them to `.gitignore`; re-run CI");
    if (overlaps.length) nextStepsParts.push("Review overlaps with referenced PRs");
    const nextSteps = nextStepsParts.length ? `> Next Steps — ${nextStepsParts.join("; ")}` : null;

    const conflictsBlock = overlaps.length ? [
        "> [!WARNING]",
        "> Possible Conflicts:",
        ...conflictLines.split("\n").map(line => `> ${line}`),
    ].join("\n") : null;

    const sensitiveBlock = sensitive.length ? [
        "> [!IMPORTANT]",
        "> Sensitive Artifacts:",
        ...sensitive.map(s => `> - ${s.status} \`${s.file}\` (Pattern: \`${s.pattern}\`, Reason: \`${s.reason || "sensitive artifact"}\`)`),
        ">      - Please remove sensitive files and add them to `.gitignore` before merging.",
        "> ",
        "> Patterns from \`dangerous-patterns.yml\` (override with \`DANGEROUS_PATTERNS_FILE\`).",
    ].join("\n") : null;

    const busSeverity = own.busFactor <= 1
        ? "🚨 Low redundancy"
        : own.busFactor === 2
            ? "⚠️ Moderate coverage"
            : "✅ Shared knowledge";

    const hasTests = files.some(isTestFile);

    const version = resolveVersion();

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
        `> Contributors: ${mentions.map(c => `\`${c}\``).join(", ")} | Bus factor: **${own.busFactor}** (${busSeverity})`,
        "",
        `Created with [Voyrox/Nightwatch](https://github.com/Voyrox/Nightwatch) version ${version}`,
    ].filter(v => v !== null && v !== undefined).join("\n");

    await upsertComment(prNumber, md);
    console.log("Posted/updated PR Nightwatch comment");
})().catch((e) => {
    console.error(e);
    process.exit(1);
});