# CI secret sync (`op://` → GitHub Actions secrets) — GOL-342

Declarative, reusable sync so wiring a CI secret is **one manifest line + a rerun**,
not a per-secret copy-paste that pulls in the org owner ([GOL-252], [GOL-145]).

## Files

| File | Role |
|------|------|
| [`../infra/ci-secrets.yaml`](../infra/ci-secrets.yaml) | **Source of truth.** `op_ref → repo → SECRET_NAME` (+ optional `gate:`). |
| [`sync-ci-secrets.sh`](sync-ci-secrets.sh) | Repo-agnostic runner: `op read \| gh secret set`, idempotent, verifies via secret metadata. |
| [`ci-secrets-tfvars.sh`](ci-secrets-tfvars.sh) | Emits `TF_VAR_ci_secrets` JSON from the manifest for the Terraform path. |
| [`_parse-ci-secrets.py`](_parse-ci-secrets.py) | Dependency-free manifest parser (no PyYAML needed). |
| [`../infra/terraform/github-ci-secrets.tf`](../infra/terraform/github-ci-secrets.tf) | Terraform source of truth for **AgenticOS**'s own secrets (`for_each` + drift detection). |

## Add a new secret

1. Add one entry to `infra/ci-secrets.yaml`:
   ```yaml
     - op_ref: op://Goldberry Grove - Admin/<item>/<field>
       repo:   owner/name
       name:   MY_SECRET_NAME
   ```
2. Rerun the sync (idempotent — safe any number of times):
   ```bash
   GH_TOKEN=<write-scoped token for that repo> tools/sync-ci-secrets.sh --repo owner/name
   # preview first with --dry-run
   ```
   For **AgenticOS**, prefer Terraform (drift detection):
   ```bash
   export TF_VAR_ci_secrets="$(tools/ci-secrets-tfvars.sh --repo Goldberry-Playground/AgenticOS)"
   terraform -chdir=infra/terraform apply -var manage_github_ci_secrets=true
   ```

`gate: <reason>` on a row = intentionally **not** synced yet; the runner skips it and
prints the reason (used for rows whose target repo has no write token, or whose
`op_ref` isn't confirmed). Remove `gate:` to activate.

## Write-capability matrix (verified by real PUT tests, 2026-07-13)

| Repo | Write path | Status |
|------|-----------|--------|
| `Goldberry-Playground/grove-sites` | Grove Infra PAT (`op://…/Grove Infra/github_token`) | ✅ **self-serve now** — unblocks [GOL-145] |
| `Goldberry-Playground/AgenticOS` | — | ⛔ App token = **read-only** (`public-key`=200 but `PUT`=403); no write PAT. Gate stays off. |
| `Goldberry-Playground/odoocker` | — | ⛔ App not installed (401); no PAT access (404). |

> **`public-key = 200` proves READ scope only — it does NOT imply write.** The GOL-342
> premise ("public-key=200 ⇒ can set secrets") was disproven by an actual `PUT`
> returning `403 Resource not accessible by integration` on both AgenticOS and grove-sites
> App tokens. The one proven write path is the Grove Infra PAT on grove-sites.

## Token resolution (per repo)

`sync-ci-secrets.sh` resolves a token in this order, then pre-flights each repo
(GET `public-key`) and marks repos it can't even read `no-access`:

1. `$GH_TOKEN` — used for all repos (CI: the one bootstrap secret / OIDC token).
2. `op read $GH_TOKEN_OP_REF` — default `op://Goldberry Grove - Admin/Grove Infra/github_token`.
3. `$GH_TOKEN_BROKER_URL/token?owner&repo` — shared GitHub App token (sandbox).

## Safety

- Secret values go to `gh secret set` **on stdin** — never argv, never logged (only lengths).
- GitHub encrypts at rest; the Terraform `value` field is write-only (never read into state).
- Idempotent: re-running updates in place; verified by the changing `updated_at` metadata.

[GOL-252]: ../ (see issue GOL-252)
[GOL-145]: ../ (see issue GOL-145)
