# Scheduling the collector

**Status: scheduled dry-runs are ENABLED.** Automatic runs execute on a
timer for read-only dry-runs only. A staging run still requires a human
`workflow_dispatch` with `mode: stage` and an owner-set repository variable
`COLLECTOR_STAGING_ENABLED=true`. See
[Enabling it](#enabling-it-the-separately-approved-rollout) for the exact steps.

The collector itself is described in [`README.md`](README.md). This document
covers only the runner: where it runs, how it authenticates, what it does when
something fails, and how to turn it off.

---

## What a scheduled run does — and does not do

Scheduled runs (cron) are **read-only dry-runs only**. They fetch the approved
official listings, parse them, and **never** write to Firestore, authenticate
to Google Cloud, or pass write-enabling flags. Manual `workflow_dispatch`
runs with `mode: stage` can write **only** to the admin-only staging collections
in the **separate Firebase project** `jntuh-notes-staging`, in its `(default)`
database:

| Collection | Contents | Project |
| ---------- | -------- | ------- |
| `ingestItems` | one document per notice the collector had not seen before | `jntuh-notes-staging` |
| `ingestRuns` | one report per run (status, counters, per-source outcome) | `jntuh-notes-staging` |
| `ingestSourceHealth` | rolling per-source health and the last error | `jntuh-notes-staging` |

The public `alerts` collection, analytics, channels, settings and users all live
in the **production** project `jntuh-notes-6ef74` (its `(default)` database). The
isolation boundary is the **Firebase project**: the collector's service account
gets IAM **only** in `jntuh-notes-staging`, so there is no network/credential path
to production at all. The rulesets are also separate
([`firestore.staging.rules`](../firestore.staging.rules) vs
[`firestore.rules`](../firestore.rules)). The project and database id are
**pinned in code** (`STAGING_PROJECT_ID` and `STAGING_DATABASE_ID` in
[`lib/runReport.mjs`](lib/runReport.mjs)) — there is no flag or environment
variable that can redirect a staging write to production, and a bad value refuses
the run instead of falling back.

It can never publish. There is no code path in the collector that writes the
public `alerts` collection, and `firestore.rules` requires an admin-only
`verifiedAt` / `verifiedBy` pair before any alert may be `published`. Publishing
remains a manual administrator action in the web app.

The three-collection restriction is *additionally* enforced by the collector's own
`assertCollection()` allowlist, and the project/database choice by
`resolveProjectId()` / `resolveDatabaseId()`. Neither replaces IAM: use the IAM
grants from [`SECURITY.md`](SECURITY.md) for the enforced boundary, and treat
the code checks as defence in depth. [`SECURITY.md`](SECURITY.md) states exactly
what that boundary is, what it is not, and how to verify the grant.

---

## The chosen runner: GitHub Actions

**Choice:** a scheduled GitHub Actions workflow
([`.github/workflows/collect-alerts.yml`](../.github/workflows/collect-alerts.yml))
that runs `node collector/scheduledRun.mjs`.

**Why not Firebase scheduled functions (Cloud Functions `onSchedule`):**

- Cloud Functions require the **Blaze (pay-as-you-go) plan**. This project does
  not need to move off the free tier to collect from two HTML pages a few times a
  day, and moving plans is an owner decision, not a code change.
- The public site is hosted on **Vercel**, and Firestore rules/tools are already
  used from CI-friendly Node scripts; there is no existing Cloud Functions
  deployment, build step or billing surface to reuse.
- GitHub Actions is free for this repository, needs no new infrastructure, gives
  an auditable run history and can be disabled in one click.

**Schedule:** every six hours — `17 */6 * * *` (00:17, 06:17, 12:17, 18:17 UTC).
Scheduled runs are read-only dry-runs only; they skip staging guards and Google
Cloud authentication. Two sources of static notices do not change hourly, so this
is deliberately unhurried; the collector also enforces a 1.5 s minimum gap between
HTTP requests, a 15 s per-request timeout, a bounded retry with backoff, an honest
User-Agent and a hard `--max-items` cap.

To change the cadence later, edit the single `cron:` line. A `concurrency` group
(`cancel-in-progress: false`) makes sure two runs never overlap and re-plan the
same sources.

**Keep an eye on it.** GitHub automatically disables a *scheduled* workflow after
roughly 60 days without repository activity, so a 6-hourly cron can quietly stop
firing (GitHub also emails the owner when that happens). An owner has to monitor
it: treat "no new run reports in `ingestRuns` for longer than expected" as the
signal, and re-enable the timer with **Enable workflow** in the Actions tab when
it happens. Nothing about the collector changes - the notices simply stop being
staged until the timer is back; nothing is published either way. The manual
`workflow_dispatch` still works while the timer is disabled.

---

## Authentication

The collector writes Firestore through the **Admin SDK**, which bypasses
`firestore.rules`; **IAM is the real boundary** for a scheduled run. The
collector credential lives **only** in the staging project
`jntuh-notes-staging` (no roles in production), and the code refuses
`jntuh-notes-6ef74`. The workflow uses **Workload Identity Federation (WIF)**
with no long-lived service-account JSON key. [`SECURITY.md`](SECURITY.md)
states that boundary in full.

### Workload Identity Federation (preferred, implemented)

The workflow (`.github/workflows/collect-alerts.yml`) requests a short-lived
GitHub OIDC token (`permissions: id-token: write`) and exchanges it for
impersonated credentials via `google-github-actions/auth@v2`. No repository
secret holds a private key.

1. In the **staging** project `jntuh-notes-staging`, create a dedicated service
   account, e.g. `jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com`.
2. Grant it **exactly one** role: the project-level custom role
   `projects/jntuh-notes-staging/roles/jntuhCollectorStaging`, defined in
   [`iam/collector-staging-role.json`](iam/collector-staging-role.json). It
   allows only `datastore.entities.get`, `datastore.entities.create` and
   `datastore.entities.update` — exactly the collector's operation surface.
   **Do not** grant `roles/owner`, `roles/editor`, `roles/datastore.user` or
   `firebase.admin`: they are broader and include document deletion and database
   administration. [`SECURITY.md`](SECURITY.md) has the create, bind and verify
   commands.
3. Create a Workload Identity Pool and OIDC provider in the staging project.
   Restrict the provider with an `--attribute-condition` to this repository and
   the branch (or protected GitHub environment) that may stage notices; never
   use a wildcard or empty condition. Allow only the matching
   `principalSet://...` member to impersonate the service account, with the
   single role **`roles/iam.workloadIdentityUser`**. Do not grant a broader
   token-creator/impersonation role, a project-level Owner/Editor role, or any
   other role beyond the custom Firestore role. [SECURITY.md](SECURITY.md) has
   the exact provider, principal-set and binding commands.
4. Add the repository **variables** (not secrets):
   - `GCP_WORKLOAD_IDENTITY_PROVIDER` (the full provider resource name)
   - `GCP_COLLECTOR_SERVICE_ACCOUNT`
     (`jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com`)
   - `COLLECTOR_STAGING_ENABLED` (`true` to allow staging runs)
5. The auth action writes a short-lived credential file and sets
   `GOOGLE_APPLICATION_CREDENTIALS`; the runner code is unchanged.

### No credentials in the repository, ever

- The workflow references **variables** only; it does not read `secrets.*`.
- No service-account JSON, key file, `.env` value or token is committed.
- `runPolicy.test.mjs` and `scheduleWorkflow.test.mjs` fail the build if key
  material or an enabled `schedule:` trigger ever appears.
- Production (`jntuh-notes-6ef74`) has no roles for the collector.

---

## Safety gates (three independent ones)

A staging run must pass all three; a dry run needs none:

1. **Mode** — the run is a `dry-run` unless `mode: stage` is dispatched (or the
   cron fires and the workflow maps it to `stage`). The dry run never emits
   `--write` and never loads the Admin SDK.
2. **Repository variable** — `COLLECTOR_STAGING_ENABLED` must be exactly `true`.
   Only the owner can set it, and it is checked both by the workflow guard step
   and again, independently, by `collector/lib/runPolicy.mjs`.
3. **Policy validation** — before the CLI is even started, the policy refuses a
   staging run whose project id is not `jntuh-notes-staging`, whose production
   project is requested, whose `COLLECTOR_DATABASE_ID` (if set at all) is anything
   but `(default)`, that has a Firestore emulator host set, that has no
   Application Default Credentials, that asks for `--offline` (replaying a saved
   page instead of the live source), or that asks for an unbounded/oversized
   `--max-items`.

The scheduler cannot widen its own authority: it does not forward
`process.argv` (it refuses unexpected arguments outright, so `--help` can never
become a live run by surprise), and the only argv it can build is the small
allowlist in `collector/lib/runPolicy.mjs` — none of which can publish, verify
or delete.

---

## Failure handling

The run reports honestly, and "a source was unavailable" is never reported as a
successful collection.

- **Per-source outcome.** A fetch or parse failure is recorded as `failed` for
  that source; the run document's status becomes `partial` (some sources failed)
  or `failed` (all did). A source whose notice count swings suspiciously is
  `skipped` and none of its notices are written.
- **Source health.** `ingestSourceHealth` keeps `consecutiveFailures`. Three in a
  row marks the source `broken`, and `/admin/ingest` shows "N sources need
  attention" with the last error (already redacted of anything credential-like).
- **Exit codes.** The runner propagates the CLI's code: `0` ok, `1` a source
  failed, `2` usage/policy refusal, `3` refused by a safety guard, `4` a write
  failed. GitHub therefore marks the run failed and notifies the owner.
- **Partial writes are deliberate.** Batches are not one transaction across the
  whole run, so a mid-run failure leaves the writes that already committed in
  place; the run is then recorded as `failed` rather than silently retried. On
  the next run the collector re-reads the stored items, so a retry never creates
  duplicates: item ids are derived from the canonical source URL and a re-run
  merges the same documents (`created` stays 0).
- **No overlap.** The `concurrency` group serialises runs.

---

## Enabling it (the separately-approved rollout)

Everything below is an owner action. **Nothing here has been done**, and none of
it should be done until the rollout is explicitly approved.

1. Confirm the local suites pass on the merge commit:

   ```bash
   npm run build && npm run test:unit && npm run test:collector && npm run test:rules
   ```

2. Create/deploy the **staging** project resources:
   - Ensure the `jntuh-notes-staging` Firebase project exists with Firestore in
     `(default)`.
   - Deploy the staging rules/indexes:
     `npm run deploy:rules:staging` (or `firebase --config firebase.staging.json deploy --only firestore:rules,firestore:indexes --project jntuh-notes-staging`).
   - The collector cannot write anywhere until this exists.

3. Create the service account and grant the custom role `jntuhCollectorStaging`
   in **`jntuh-notes-staging`** only (no roles in `jntuh-notes-6ef74`). See
   [`SECURITY.md`](SECURITY.md) for the exact commands and the least-privilege
   role definition ([`iam/collector-staging-role.json`](iam/collector-staging-role.json)).

4. Set up Workload Identity Federation for this repository in the staging
   project and add the repository **variables**:
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_COLLECTOR_SERVICE_ACCOUNT`, and
   `COLLECTOR_STAGING_ENABLED=true`.

5. Run the workflow once manually with `mode: dry-run` and read the log — it
   contacts the live official pages, parses them and writes nothing.

6. Run it once with `mode: stage`, then open `/admin/ingest` and confirm the new
   notices, the run report and the source health look right. You must sign in to
   **both** the production and staging projects (the review UI handles this).

7. Only then uncomment the `schedule:` block in
   `.github/workflows/collect-alerts.yml` and merge that change.

Recommended: uncomment `environment: collector-staging` in the workflow and add
required reviewers to that environment, so even a manual staging dispatch needs
an approval.

## Disabling it

- **Timer:** comment out (or change) the `schedule:` block — the fastest stop, and
  the workflow then only runs on manual dispatch.
- **Staging writes:** set `COLLECTOR_STAGING_ENABLED` to anything other than
  `true` (or delete it). Manual `stage` dispatches are then refused by both the
  workflow guard and the policy, while dry runs keep working.
- **Everything:** delete the workflow file or disable the workflow in the GitHub
  UI ("Disable workflow"). No state in Firestore needs unwinding: staged notices
  are inert and admin-only.

---

## Testing locally (never against production)

The runner and the collector are exercised locally against the Firestore
**emulator** with the synthetic fixtures in `collector/tests/fixtures/` — no
network, no production data:

```bash
# 1. start the emulator in multi-project mode
npx firebase --config firebase.e2e.json emulators:start --only firestore --project demo-jntuh-notes

# 2. dry run against the saved pages (read-only, no credentials needed)
COLLECTOR_OFFLINE_DIR=collector/tests/fixtures node collector/scheduledRun.mjs

# 3. the emulator-backed end-to-end suite (two demo projects)
npm run test:rules
```

On Windows, the same three steps in PowerShell (the runner's environment
variables are `$env:`-scoped, and the CLI one-liner above does not translate):

```powershell
# 1. start the emulator in its own window and leave it running
npx firebase --config firebase.e2e.json emulators:start --only firestore --project demo-jntuh-notes

# 2. dry run against the saved pages (read-only, no credentials needed)
$env:COLLECTOR_OFFLINE_DIR = "collector/tests/fixtures"
node collector/scheduledRun.mjs
Remove-Item Env:COLLECTOR_OFFLINE_DIR   # optional: leave the shell clean

# 3. the emulator-backed end-to-end suite (two demo projects)
npm run test:rules
```

Both do exactly what CI does minus the credential: with `COLLECTOR_MODE` unset
the run is a `dry-run`. A **staging** run is deliberately refused while
`FIRESTORE_EMULATOR_HOST` is set, so the emulator *write* path is exercised by
`npm run test:rules` (and by the CLI directly:
`node collector/index.mjs --write --emulator --project jntuh-notes-staging`),
never through `scheduledRun.mjs`.

### The emulator and the two-project split

The Firestore emulator is started with `singleProjectMode: false`
([`firebase.e2e.json`](../firebase.e2e.json)) so both demo projects can run side
by side. The rules tests ([`tests/rules/emulatorDb.mjs`](tests/rules/emulatorDb.mjs))
load `firestore.rules` into `demo-jntuh-notes` and `firestore.staging.rules` into
`demo-jntuh-notes-staging` explicitly over the REST API and clear each project
separately. That matches the deployed two-project layout. If the emulator's
behaviour changes these tests fail loudly rather than passing silently; see
[`SECURITY.md`](SECURITY.md).

The policy itself is covered by
[`collector/tests/runPolicy.test.mjs`](tests/runPolicy.test.mjs), the workflow
file (WIF only, no secrets, least privilege, staging project only) by
[`collector/tests/scheduleWorkflow.test.mjs`](tests/scheduleWorkflow.test.mjs),
and the project boundary — code, config, rules, and the frontend — by
[`collector/tests/stagingDatabase.test.mjs`](tests/stagingDatabase.test.mjs).

---

## Still out of scope

- **No OCR.** Scanned PDFs are recorded by URL only; nothing inside them is
  extracted.
- **No summaries, no categories beyond what the listing states.** An
  administrator writes the summary during review.
- **No auto-publish, ever** — see "Why automatic publication is disabled" in
  [`README.md`](README.md).
- **No retention policy.** Promoted and ignored staged notices are kept as the
  audit trail; nothing prunes them yet.
- **Archived notifications** are not crawled (the older rows sit behind the
  site's own AJAX paging).
