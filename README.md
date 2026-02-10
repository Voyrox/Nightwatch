# Merge M8

Merge M8 posts a concise, actionable report directly on the PR to accelerate resolution and reduce review thrash.

### Why teams use Merge M8

- Rapid risk snapshot (score, churn, risky files)
- Conflict detection across open PRs
- Sensitive artifact detection with remediation prompts
- Ownership and bus-factor context for better reviewer assignment
- Fatigue signal to balance review load

### What the report includes

- Risk assessment and status
- Blast radius by domain (with counts)
- Possible conflicts with other open PRs
- Sensitive artifacts flagged with reasons
- Ownership and bus factor for touched files
- Fatigue signal and changed-files summary

### Installation

Copy and paste the following snippet into your workflow:

```yaml
name: "Merge M8"

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write

jobs:
  merge_m8:
    name: "Merge automation"
    runs-on: ubuntu-latest
    steps:
      - name: "Checkout (full history)"
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: "Run Merge M8"
        uses: Voyrox/Merge-M8@v1.0.4
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TZ: America/New_York # optional override (default: Australia/Sydney)
```

### Inputs

- `github_token` (required, default `${{ github.token }}`): token with permissions to read PRs and post comments.
- `timeZone` (optional, default `Australia/Sydney`): sets `TZ` for developer time calculations.
