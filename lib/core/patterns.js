const fs = require("fs");
const path = require("path");

const { regex } = require("./utils");

function dangerousPatterns() {
  const patterns = {
    banned: [{ pattern: /^\.env$/i, reason: "Dotenv file" }],
    allowed: [/^\.env\.example$/i, /\.example$/i, /sample/i, /fixtures?/i, /test-data/i],
  };

  const envPatterns = process.env.DANGEROUS_PATTERNS;
  if (envPatterns) {
    try {
      const config = parseYAML(envPatterns);
      const banned = normalizeBanned(config?.banned).filter(Boolean);
      const allowed = normalizeAllowed(config?.allowed).filter(Boolean);
      return {
        banned: banned.length ? banned : patterns.banned,
        allowed: allowed.length ? allowed : patterns.allowed,
      };
    } catch {
      // Ignore
    }
  }

  const filePath =
    process.env.DANGEROUS_PATTERNS_FILE || path.join(process.cwd(), "dangerous-patterns.yml");
  let config = null;
  try {
    const data = fs.readFileSync(filePath, "utf8");
    config = parseYAML(data);
  } catch {
    // Ignore
  }

  const banned = normalizeBanned(config?.banned).filter(Boolean);
  const allowed = normalizeAllowed(config?.allowed).filter(Boolean);

  return {
    banned: banned.length ? banned : patterns.banned,
    allowed: allowed.length ? allowed : patterns.allowed,
  };
}

function normalizeBanned(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (item && typeof item === "object" && item.pattern) {
        const re = regex(item.pattern);
        return re ? { pattern: re, reason: item.reason || null } : null;
      }
      const re = regex(item);
      return re ? { pattern: re, reason: null } : null;
    })
    .filter(Boolean);
}

function normalizeAllowed(list) {
  if (!Array.isArray(list)) return [];
  return list.map(regex).filter(Boolean);
}

function parseYAML(src) {
  const data = { banned: [], allowed: [] };
  let current = null;
  let lastEntry = null;

  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (!line.startsWith(" ") && !line.startsWith("\t") && line.trim().endsWith(":")) {
      const key = line.trim().slice(0, -1).trim();
      current = key === "banned" || key === "allowed" ? key : null;
      lastEntry = null;
      continue;
    }

    if (!current) continue;

    const trimmed = line.trim();

    const patternMatch = trimmed.match(/^-\s+pattern:\s*(.+)$/);
    if (patternMatch) {
      const entry = { pattern: patternMatch[1].trim() };
      data[current].push(entry);
      lastEntry = entry;
      continue;
    }

    if (trimmed.startsWith("-")) {
      const val = trimmed.slice(1).trim();
      if (val) data[current].push(val);
      lastEntry = null;
      continue;
    }

    const reasonMatch = trimmed.match(/^reason:\s*(.+)$/i);
    if (reasonMatch && lastEntry) {
      lastEntry.reason = reasonMatch[1].trim();
    }
  }
  return data;
}

function reasonForSensitive(file, re) {
  const lower = file.toLowerCase();
  if (/\.pem$|\.key$|\.p12$|\.pfx$|\.p8$/.test(lower)) return "Private key";
  if (/id_rsa/.test(lower)) return "SSH private key";
  if (/google-services|serviceaccount/.test(lower)) return "Cloud credentials";
  if (/\.aws\//.test(lower) || /credentials/.test(lower)) return "Credentials";
  if (/\.env/.test(lower)) return "Dotenv secrets";
  if (/\.db$|\.sqlite$/.test(lower)) return "Database dump";
  if (/\.log$/.test(lower)) return "Log output";
  if (/node_modules\//.test(lower)) return "Vendored dependencies";
  if (/dist\//.test(lower)) return "Build output";
  if (/\.vscode|\.idea/.test(lower)) return "IDE settings";
  if (/coverage|nyc_output/.test(lower)) return "Coverage output";
  if (/thumbs\.db|\.ds_store/.test(lower)) return "OS artifact";
  if (/tfvars/.test(lower)) return "Terraform secrets";
  if (/docker-compose\.override/.test(lower)) return "Service credentials";
  return `Sensitive (${re.toString()})`;
}

function findSensitiveFiles(baseRef, files) {
  const cfg = dangerousPatterns();
  const { sh } = require("./shell");
  let statusLines = [];
  try {
    statusLines = sh(`git diff --name-status origin/${baseRef}...HEAD`)
      .trim()
      .split("\n")
      .filter(Boolean);
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

module.exports = {
  dangerousPatterns,
  normalizeBanned,
  normalizeAllowed,
  parseYAML,
  reasonForSensitive,
  findSensitiveFiles,
};
