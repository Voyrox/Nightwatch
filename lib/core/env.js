const fs = require("fs");
const path = require("path");

function loadEnv() {
  const GH = process.env.GITHUB_TOKEN;
  if (!GH) throw new Error("Missing GITHUB_TOKEN");

  const eventPath = process.env.GITHUB_EVENT_PATH || path.join(process.cwd(), "event.json");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

  const isPR = !!event.pull_request;
  const owner = event.repository?.owner?.login;
  const repo = event.repository?.name;
  const prNumber = event.pull_request?.number;
  const baseRef = event.pull_request?.base?.ref || "main";

  return {
    GH,
    eventPath,
    event,
    isPR,
    owner,
    repo,
    prNumber,
    baseRef,
  };
}

module.exports = { loadEnv };
