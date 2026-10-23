# Collector security model

This document is the honest account of the boundary. It describes what is
enforced, what is *not* enforced by any single mechanism, and how to verify
the grant that makes the automatic collection usable.

> **Quick summary:** the collector writes **only** to the separate Firebase
> project **`jntuh-notes-staging`** (its `(default)` database). The production
> project **`jntuh-notes-6ef74`** has no IAM roles for the collector, the web app
> uses a second Firebase app for staging review, and promotion creates a draft
> in production (two steps, two projects) — it never publishes. Publishing is a
> separate admin action. There are no long-lived keys in the repository: the
> GitHub workflow uses **Workload Identity Federation**.

---

## The boundary (what isolates the collector)

| Concern | Enforced by | Notes |
| --- | --- | --- |
| **Project isolation (the real boundary)** | Google Cloud IAM on `jntuh-notes-staging` | The service account exists only in the staging project and has **no** roles in `jntuh-notes-6ef74`. A bug in the collector cannot reach production because there are no credentials and no permission for it. |
| **Least privilege for Firestore** | A project-level custom role `jntuhCollectorStaging` ([`iam/collector-staging-role.json`](iam/collector-staging-role.json)) | Grants only `datastore.entities.get`, `datastore.entities.create`, `datastore.entities.update`. It has **no** `datastore.entities.delete` and **no** database-administration permissions. Firestore IAM has **no collection-level granularity** (see below). |
| **Pinned target (fail closed)** | `collector/lib/runPolicy.mjs` and `collector/lib/firestoreAdmin.mjs` | The project is pinned to `jntuh-notes-staging`; `jntuh-notes-6ef74` is refused unconditionally, even if injected. The database is pinned to `(default)` in the staging project. `--allow-production` is a live-write gate for staging only. |
| **Client rules** | [`firestore.staging.rules`](../firestore.staging.rules) deployed to `jntuh-notes-staging`, [`firestore.rules`](../firestore.rules) to `jntuh-notes-6ef74` | The Admin SDK bypasses these rules, but the rules protect the browser: a client can only read/write ingest collections in the **staging project** with an **admin claim for that project**, and the production rules deny the ingest collections by default. |
| **Two-app admin session** | [`src/lib/firebase.js`](../src/lib/firebase.js), [`src/lib/adminAuth.js`](../src/lib/adminAuth.js), [`src/pages/admin/AdminIngest.jsx`](../src/pages/admin/AdminIngest.jsx) | A Firebase Auth token is scoped to one project. The review UI opens a second app for `jntuh-notes-staging` and asks for a staging admin session (best-effort at login, with an explicit fallback). Production login never grants staging access. |
| **Never publishes** | No code path + rules | The collector only writes `ingestItems`, `ingestRuns`, `ingestSourceHealth`. Promotion creates an **unverified draft** in the production project (two-step, deterministic id, idempotent). `firestore.rules` requires `verifiedAt` and `verifiedBy` before `published`. |
| **No key material** | GitHub Actions WIF | The workflow uses `google-github-actions/auth@v2` with `id-token: write` and repository **variables** (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_COLLECTOR_SERVICE_ACCOUNT`). No `secrets.FIREBASE_SERVICE_ACCOUNT` is read. |

---

## What IAM can and cannot do

Firestore's server-client IAM roles are **database-granular, not collection-granular**. A permission like `datastore.entities.get` applies to documents in the database(s) the role is bound to, subject to conditions. That is why:

- **The project split is the isolation:** put the collector in its own project with its own IAM, and it cannot reach the other project at all. This is enforceable and auditable.
- **The custom role is still worth having:** it removes `datastore.entities.delete` and all administration permissions that `roles/datastore.user` would include, and makes the intended surface auditable in code and in `iam/collector-staging-role.json`.
- **The role provides no collection isolation.** The IAM role is database-wide and does not isolate individual collections. Treating a collection-level restriction as an IAM guarantee is incorrect. The separate Firebase project **does** isolate the production `alerts` collection: the collector's credential exists only in `jntuh-notes-staging` and has no roles in `jntuh-notes-6ef74`, while separate rulesets and separate Auth sessions keep the browser surface apart. The role is least privilege, not a collection firewall.

The checked-in role is pinned by [`collector/tests/iam.permissions.test.mjs`](../collector/tests/iam.permissions.test.mjs).

### The checked-in role

```json
{
  "title": "JNTUH alert collector - staging writer",
  "description": "Least-privilege Firestore data role for the JNTUH alert collector service account (jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com). It may read documents by id and create/update documents, which is exactly what the collector's staging write path does (db.getAll + batch.set with merge). It deliberately grants no datastore.entities.delete, no datastore.databases.*, no datastore.schemas.*, no datastore.operations.*, no import/export/bulk/backup/restore permission and no resourcemanager.projects.* permission. WARNING: Firestore IAM is database-granular, never collection-granular, so this role is scoped to the whole database; the three staging collections are enforced by the collector's own allowlist, not by this role. The isolation boundary is the separate staging project; this role must be bound only there. See collector/SECURITY.md.",
  "stage": "GA",
  "includedPermissions": [
    "datastore.entities.get",
    "datastore.entities.create",
    "datastore.entities.update"
  ]
}
```

---

## Setting it up (owner actions)

Nothing below has been done. Do not run these commands unless you intend to change cloud resources; the repository already reflects the two-project layout and will fail closed until the projects/roles/WIF are configured.

### 1) Create the staging project and enable Firestore

Create `jntuh-notes-staging` in Google Cloud/Firebase. Enable Firestore in **Native mode** for the `(default)` database. Do **not** reuse the production project.

### 2) Deploy rules to both projects

```bash
# Production
npm run deploy:rules

# Staging
npm run deploy:rules:staging
```

The production config ([`firebase.json`](../firebase.json)) deploys `firestore.rules` to `jntuh-notes-6ef74`. The staging config ([`firebase.staging.json`](../firebase.staging.json)) deploys `firestore.staging.rules` to `jntuh-notes-staging`.

### 3) Create the staging service account and least-privilege role

From `gcloud` authenticated as an owner of `jntuh-notes-staging`:

```bash
gcloud iam service-accounts create jntuh-staging-collector \
  --project=jntuh-notes-staging \
  --display-name="JNTUH Notices collector (staging only)"
```

Create the custom role from the checked-in definition:

```bash
gcloud iam roles create jntuhCollectorStaging \
  --project=jntuh-notes-staging \
  --file=collector/iam/collector-staging-role.json
```

Bind the custom role to the service account **in the staging project only** (no binding in `jntuh-notes-6ef74`). The service account itself needs no project role beyond this one; the WIF principal set is granted the narrow impersonation role `roles/iam.workloadIdentityUser` on the service account in step 4.

```bash
gcloud projects add-iam-policy-binding jntuh-notes-staging \
  --member="serviceAccount:jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com" \
  --role="projects/jntuh-notes-staging/roles/jntuhCollectorStaging"
```

**Verify the boundary:**
```bash
gcloud projects get-iam-policy jntuh-notes-6ef74 \
  --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com"
```
This must return **nothing**. If it does, remove the binding.

### 4) Configure Workload Identity Federation for GitHub Actions

In `jntuh-notes-staging`:

1. Create the Workload Identity Pool:

   ```bash
   gcloud iam workload-identity-pools create github-actions \
     --project=jntuh-notes-staging \
     --location=global \
     --display-name="GitHub Actions"
   ```

2. Create the OIDC provider. Restrict the attribute condition to this repository
   and the branch (or GitHub environment) that may stage notices:

   ```bash
   gcloud iam workload-identity-pools providers create-oidc github \
     --project=jntuh-notes-staging \
     --location=global \
     --workload-identity-pool=github-actions \
     --display-name="GitHub Actions (JNTUH collector)" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
     --attribute-condition="assertion.repository == '<owner>/<repo>' && assertion.ref == 'refs/heads/<branch>'"
   ```

   Use a single repository and a single branch (or, if you use the
   `collector-staging` environment gate, `assertion.environment == 'collector-staging'`)
   in the condition. Never use `*`, an empty condition, or a repository-owner
   wildcard: the condition is the trust boundary for the whole pool.

3. Grant only the WIF principal set permission to impersonate the staging
   service account, and grant only `roles/iam.workloadIdentityUser`:

   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com \
     --project=jntuh-notes-staging \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/<staging-project-number>/locations/global/workloadIdentityPools/github-actions/attribute.ref/refs/heads/<branch>"
   ```

   Scope the principal set to the same repository/branch/environment as the
   provider condition (the `attribute.ref/...` member above pins the branch). Do
   not bind a project-level role such as Owner, Editor or Datastore User to the
   principal set, and do not grant a broader service-account token-minting role:
   impersonation plus the custom Firestore role is the entire grant. If you use
   the GitHub environment gate, narrow the member to
   `attribute.environment/collector-staging` instead.

   The workflow ships with an optional `environment: collector-staging` approval
   gate (commented by default) for extra protection.

In GitHub (repository Settings → Secrets and variables → Actions → Variables):
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = `projects/<staging-project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`
- `GCP_COLLECTOR_SERVICE_ACCOUNT` = `jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com`
- `COLLECTOR_STAGING_ENABLED` = `true` (only when ready)

No secrets are needed for authentication.

### 5) Prepare the web app for two-project review

Add the staging web config to your deployment environment (e.g. `.env.local` or
Vercel environment variables). The keys are documented in [`.env.example`](../.env.example):

- `VITE_STAGING_FIREBASE_API_KEY`
- `VITE_STAGING_FIREBASE_AUTH_DOMAIN` (usually `jntuh-notes-staging.firebaseapp.com`)
- `VITE_STAGING_FIREBASE_PROJECT_ID` (`jntuh-notes-staging`)
- `VITE_STAGING_FIREBASE_STORAGE_BUCKET`
- `VITE_STAGING_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_STAGING_FIREBASE_APP_ID`

The app **hard-refuses** any other project id. The `/admin/ingest` page will show
a "Connect the staging project" panel if the staging session is missing.

Also ensure both projects have the administrators' accounts with the `admin`
custom claim set (production and staging separately). A production admin claim
does not grant access to the staging project.

---

## Residual risks and mitigations

| Risk | Mitigation | Status |
| --- | --- | --- |
| WIF misconfiguration allows impersonation | Narrow the pool/provider condition to this repository and branch; use the GitHub environment `collector-staging` with required reviewers. | Configurable; workflow supports it. |
| Staging credential is compromised | Project-limited IAM, custom role (no delete/admin), keyless (WIF), no production roles, Firestore rules deny alerts, collector never publishes. Rotate by reconfiguring WIF/pool. | Mitigated by design, not eliminable. |
| Client points at wrong project | `getStagingApp()` refuses `VITE_STAGING_*` with any project id other than `jntuh-notes-staging`. Production promotion always uses the production app. | Enforced in code. |
| Staging session missing | `AdminIngest.jsx` gates on staging auth and provides an explicit sign-in form; production login is best-effort only. | Enforced in UI + rules. |
| Database/project typo | `resolveProjectId`, `resolveDatabaseId` fail closed; CLI and policy refuse production, refuse named databases. Tests pin constants. | Enforced in code + tests. |
| Emulator vs real layout | `firebase.e2e.json` uses `singleProjectMode: false`, rules tests load both sets into separate demo projects. | Covered by tests. |
| `firebase-tools` rules deployment to named DB | Production deploys `firestore.rules` to `(default)`, staging deploys `firestore.staging.rules` via `firebase.staging.json` to `jntuh-notes-staging`. `firebase.json` has no named database entry. | Enforced in config + tests. |

---

## Quick reference

- **Staging project:** `jntuh-notes-staging` / `(default)`
- **Production project:** `jntuh-notes-6ef74` / `(default)`
- **Staging rules:** `firestore.staging.rules` (deploy via `npm run deploy:rules:staging`)
- **Production rules:** `firestore.rules` (deploy via `npm run deploy:rules`)
- **Workflow:** `.github/workflows/collect-alerts.yml` (WIF, `workflow_dispatch` only, schedule commented)
- **Custom role:** `projects/jntuh-notes-staging/roles/jntuhCollectorStaging` ([`collector/iam/collector-staging-role.json`](iam/collector-staging-role.json))
- **Gate switches:** `COLLECTOR_STAGING_ENABLED` (repo variable), `--allow-production` (live staging write gate), `FIRESTORE_EMULATOR_HOST` (emulator mode)