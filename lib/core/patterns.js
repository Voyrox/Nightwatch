const fs = require("fs");
const path = require("path");

const { toRegex } = require("./utils");

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
    allowed: [/^\.env\.example$/i, /\.example$/i, /sample/i, /fixtures?/i, /test-data/i],
  };

  const cfgPath =
    process.env.DANGEROUS_PATTERNS_FILE || path.join(process.cwd(), "dangerous-patterns.yml");
  let userCfg = null;
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    userCfg = parseSimpleYaml(raw);
  } catch {
    // Fall back to defaults
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
  return list
    .map((item) => {
      if (item && typeof item === "object" && item.pattern) {
        const re = toRegex(item.pattern);
        return re ? { pattern: re, reason: item.reason || null } : null;
      }
      const re = toRegex(item);
      return re ? { pattern: re, reason: null } : null;
    })
    .filter(Boolean);
}

function normalizeAllowed(list) {
  if (!Array.isArray(list)) return [];
  return list.map(toRegex).filter(Boolean);
}

function parseSimpleYaml(src) {
  const out = { banned: [], allowed: [] };
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
    }
  }
  return out;
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

function findSensitiveFiles(baseRef, files) {
  const cfg = loadDangerousPatterns();
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
  loadDangerousPatterns,
  normalizeBanned,
  normalizeAllowed,
  parseSimpleYaml,
  reasonForSensitive,
  findSensitiveFiles,
};
