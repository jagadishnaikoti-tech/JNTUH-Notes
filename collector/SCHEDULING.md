# Scheduling the collector

**Status: the scheduler is implemented but DISABLED.** Nothing collects on a
timer today. A collection run happens only when a human dispatches it, and a
staging run additionally requires an owner-set repository variable. See
[Enabling it](#enabling-it-the-separately-approved-rollout) for the exact steps.

The collector itself is described in [`README.md`](README.md). This document
covers only the runner: where it runs, how it authenticates, what it does when
something fails, and how to turn it off.

---

## What a scheduled run does — and does not do

A run fetches the approved official listings, parses them and writes **only** to
the admin-only staging collections:

| Collection | Contents |
| ---------- | -------- |
| `ingestItems` | one document per notice the collector had not seen before |
| `ingestRuns` | one report per run (status, counters, per-source outcome) |
| `ingestSourceHealth` | rolling per-source health and the last error |

It can never publish. There is no code path in the collector that writes the
public `alerts` collection, and `firestore.rules` requires an admin-only
`verifiedAt` / `verifiedBy` pair before any alert may be `published`. Publishing
remains a manual administrator action in the web app.

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

**Schedule (proposed, currently commented out):** every six hours —
`17 */6 * * *` (00:17, 06:17, 12:17, 18:17 UTC). Two sources of static notices do
not change hourly, so this is deliberately unhurried; the collector also enforces
a 1.5 s minimum gap between HTTP requests, a 15 s per-request timeout, a bounded
retry with backoff, an honest User-Agent and a hard `--max-items` cap.

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
`firestore.rules`; **IAM is the real boundary** for a scheduled run. Two options
are supported; both keep the credential out of the repository.

### Option A — service-account secret (implemented)

1. Create a dedicated service account in the Firebase/GCP project, e.g.
   `collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com`.
2. Grant it **exactly one** role: `roles/datastore.user` (Firestore read/write).
   Do **not** grant `roles/owner`, `roles/editor` or `firebase.admin`.
3. Add its JSON key as the repository secret `FIREBASE_SERVICE_ACCOUNT`.
4. The workflow writes that secret to `$RUNNER_TEMP/collector-service-account.json`
   (mode `0600`) and points `GOOGLE_APPLICATION_CREDENTIALS` at it. The key never
   touches the repository, the logs (GitHub masks it) or a longer-lived file.

Rotate the key on a schedule; a leaked key is the main residual risk of this
option.

### Option B — Workload Identity Federation (preferred long-term)

No long-lived key at all: GitHub's OIDC token is exchanged for a short-lived
access token.

1. In GCP, create a workload identity pool + provider trusting this repository,
   and a service account with `roles/datastore.user`.
2. Allow the repository to impersonate it.
3. Replace the "Write the service-account credential…" step with
   `google-github-actions/auth@v2`, and keep `permissions: id-token: write`
   (already set).

The runner code does not change: it still reads
`GOOGLE_APPLICATION_CREDENTIALS`, which that action populates.

### No credentials in the repository, ever

- The workflow references the secret **by name** only.
- No service-account JSON, key file, `.env` value or token is committed.
- `runPolicy.test.mjs` and `scheduleWorkflow.test.mjs` fail the build if key
  material or an enabled `schedule:` trigger ever appears.

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
   staging run whose project id is not `jntuh-notes-6ef74`, that has a Firestore
   emulator host set, that has no Application Default Credentials, that asks for
   `--offline` (replaying a saved page instead of the live source), or that asks
   for an unbounded/oversized `--max-items`.

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

2. Create the service account and grant `roles/datastore.user` (Option A above),
   then add the `FIREBASE_SERVICE_ACCOUNT` repository secret.
3. Set the repository variable `COLLECTOR_STAGING_ENABLED=true`.
4. Run the workflow once manually with `mode: dry-run` and read the log — it
   contacts the live official pages, parses them and writes nothing.
5. Run it once with `mode: stage`, then open `/admin/ingest` and confirm the new
   notices, the run report and the source health look right.
6. Only then uncomment the `schedule:` block in
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
# 1. start the emulator (demo- project id: firebase-tools refuses real projects)
npx firebase --config firebase.e2e.json emulators:start --only firestore --project demo-jntuh-notes

# 2. dry run against the saved pages (read-only, no credentials needed)
COLLECTOR_OFFLINE_DIR=collector/tests/fixtures node collector/scheduledRun.mjs

# 3. the emulator-backed end-to-end suite
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

# 3. the emulator-backed end-to-end suite
npm run test:rules
```

Both do exactly what CI does minus the credential: with `COLLECTOR_MODE` unset
the run is a `dry-run`. A **staging** run is deliberately refused while
`FIRESTORE_EMULATOR_HOST` is set, so the emulator *write* path is exercised by
`npm run test:rules` (and by the CLI directly:
`node collector/index.mjs --write --emulator --project jntuh-notes-6ef74`),
never through `scheduledRun.mjs`.

The policy itself is covered by
[`collector/tests/runPolicy.test.mjs`](tests/runPolicy.test.mjs), and the workflow
file (no timer, no secrets, least privilege) by
[`collector/tests/scheduleWorkflow.test.mjs`](tests/scheduleWorkflow.test.mjs).

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
