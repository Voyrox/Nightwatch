const { GH, owner, repo } = require("./env").loadEnv();

const prFilesCache = new Map();

async function getGitHub(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GH}`,
      Accept: "application/vnd.github+json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

async function prFilesAndConflicts(prNumber) {
  async function getFiles(n) {
    if (prFilesCache.has(n)) return prFilesCache.get(n);
    const fetched = await getGitHub(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${n}/files?per_page=300`,
    );
    const list = fetched.map((f) => f.filename);
    prFilesCache.set(n, list);
    return list;
  }

  const files = await getFiles(prNumber);

  const openPRs = await getGitHub(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
  );
  const others = openPRs.filter((p) => p.number !== prNumber);

  const overlaps = [];
  const fileSet = new Set(files);

  for (const pr of others.slice(0, 30)) {
    const otherFiles = await getFiles(pr.number);
    const overlap = otherFiles.filter((x) => fileSet.has(x));
    if (overlap.length) {
      overlaps.push({ number: pr.number, title: pr.title, overlap: overlap.length });
    }
  }
  overlaps.sort((a, b) => b.overlap - a.overlap);
  return { files, overlaps: overlaps.slice(0, 5) };
}

function resolveVersion() {
  try {
    const pkg = require("../../package.json");
    if (pkg && pkg.version) return pkg.version.startsWith("v") ? pkg.version : `v${pkg.version}`;
  } catch {
    return "v1.0.0";
  }
}

async function upsertComment(prNumber, body) {
  const comments = await getGitHub(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
  );
  const marker = "<!-- Merge M8 Report -->";
  const existing = comments.find((c) => (c.body || "").includes(marker));

  const finalBody = `${marker}\n${body}`;

  if (existing) {
    await getGitHub(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: finalBody }),
    });
  } else {
    await getGitHub(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: finalBody }),
    });
  }
}

module.exports = {
  getGitHub,
  prFilesAndConflicts,
  resolveVersion,
  upsertComment,
  prFilesCache,
};
