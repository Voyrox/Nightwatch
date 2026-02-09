# Nightwatch Action

Generate a PR Nightwatch report and post it as a comment.

### Usage

Add a workflow (example: `.github/workflows/pages-preview.yml`):

```yaml
name: Pages Preview

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
        uses: ./.github/actions/pages-preview
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          timeZone: America/New_York  # optional override (default: Australia/Sydney)
```

### Inputs

- `github_token` (required, default `${{ github.token }}`): token with access to read PRs and post comments.
- `timeZone` (optional, default `Australia/Sydney`): sets `TZ` for engineer state calculations.
