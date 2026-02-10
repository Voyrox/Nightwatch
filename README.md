# Merge M8

Merge M8 posts a concise, actionable report directly on the PR to accelerate resolution and reduce review thrash.

### What does it do?

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

### Snapshot
![Example Merge M8 Report](./assets/image.png)

### Installation

1. Create a new workflow file in your repository under `.github/workflows/Merge-M8.yml` (you can name it whatever you like).
2. Copy and paste the following snippet into your workflow:

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
        uses: Voyrox/Merge-M8@v1.0.5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TZ: America/New_York # optional override (default: Australia/Sydney)
          dangerousPatterns: |
            banned:
              - pattern: ^\.env$
                reason: Dotenv file
              - pattern: ^\.env\..+$
                reason: Dotenv file
              - pattern: secrets?
                reason: Contains secrets
              - pattern: credentials?
                reason: Contains credentials
              - pattern: \.pem$
                reason: Private key
              - pattern: \.key$
                reason: Private key
              - pattern: \.p12$
                reason: Private key
              - pattern: \.pfx$
                reason: Private key
              - pattern: \.crt$
                reason: Certificate
              - pattern: \.csr$
                reason: Certificate
              - pattern: \.der$
                reason: Certificate
              - pattern: \.jks$
                reason: Keystore
              - pattern: \.p8$
                reason: Private key
              - pattern: id_rsa
                reason: SSH private key
              - pattern: serviceAccountKey\.json$
                reason: Cloud credentials
              - pattern: google-services\.json$
                reason: Mobile app credentials
              - pattern: GoogleService-Info\.plist$
                reason: Mobile app credentials
              - pattern: \.aws/credentials$
                reason: Cloud credentials
              - pattern: \.npmrc$
                reason: Registry credentials
              - pattern: \.pypirc$
                reason: Registry credentials
              - pattern: \.firebase/
                reason: Cloud credentials
              - pattern: \.supabase/
                reason: Cloud credentials
              - pattern: \.expo/
                reason: App credentials
              - pattern: \.gradle/
                reason: Build secrets
              - pattern: \.keystore$
                reason: Keystore
              - pattern: terraform\.tfvars$
                reason: Terraform secrets
              - pattern: docker-compose\.override\.ya?ml$
                reason: Service credentials
              - pattern: config/.*secret.*
                reason: Secrets in config
              - pattern: \.sqlite$
                reason: Local database
              - pattern: \.db$
                reason: Local database
              - pattern: \.log$
                reason: Log output
              - pattern: \.ipynb_checkpoints/
                reason: Notebook checkpoint
              - pattern: \.vscode/settings\.json$
                reason: IDE settings
              - pattern: \.idea/
                reason: IDE settings
              - pattern: node_modules/
                reason: Vendored dependencies
              - pattern: venv/
                reason: Virtualenv
              - pattern: coverage/
                reason: Coverage output
              - pattern: \.nyc_output/
                reason: Coverage output
              - pattern: dist/
                reason: Build output
              - pattern: Thumbs\.db$
                reason: OS artifact
              - pattern: \.DS_Store$
                reason: OS artifact

            allowed:
              - pattern: ^\.env\.example$
              - pattern: \.example$
              - pattern: sample
              - pattern: fixtures?
              - pattern: test-data
```
All done! You're now ready to use the action 🎉

### Inputs

- `github_token` (required, default `${{ github.token }}`): token with permissions to read PRs and post comments.
- `timeZone` (optional, default `Australia/Sydney`): sets `TZ` for developer time calculations.
- `dangerousPatterns` (optional): YAML string to override sensitive file patterns. Or overriden with `dangerous-patterns.yml` in the repo root.
