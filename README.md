# PR Risk Assessment GitHub Action

Nightwatch is a GitHub Action for teams that need faster, higher quality pull request reviews. It posts a concise, actionable report directly on the PR to accelerate resolution and reduce review thrash.

### Why teams use Nightwatch

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

### Usage

Add Nightwatch as a drop-in GitHub Action (example workflow):

```yaml
name: PR Risk Assessment

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  pages-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Nightwatch
        uses: Voyrox/Nightwatch@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          timeZone: America/New_York  # optional override (default: Australia/Sydney)
```

### Inputs

- `github_token` (required, default `${{ github.token }}`): token with access to read PRs and post comments.
- `timeZone` (optional, default `Australia/Sydney`): sets `TZ` for developer country calculations.
