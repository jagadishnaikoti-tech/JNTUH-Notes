# Collector security boundary (Firestore IAM + database isolation)

**Status: documented and configured as code — NOT applied.** Two things are
checked in so they can be reviewed, tested and applied deliberately:

- [`iam/collector-staging-role.json`](iam/collector-staging-role.json) — the
  least-privilege custom role;
- the **separate `staging` database** the collector writes to
  ([`../firebase.json`](../firebase.json),
  [`../firestore.staging.rules`](../firestore.staging.rules), and the collector's
  pinned `STAGING_DATABASE_ID` in [`lib/runReport.mjs`](lib/runReport.mjs)).

This change created **no** Google Cloud IAM binding, **no** Firestore database,
**no** credential and **no** production data. The commands below are owner
actions, listed for the approved rollout in [`SCHEDULING.md`](SCHEDULING.md).

---

## What actually enforces "staging only"

The collector authenticates with a service account and writes through the
**Firebase Admin SDK**, which **bypasses `firestore.rules`**. The rules that keep
staged notices admin-only in a browser therefore say nothing about the collector:
for the runner, **Google Cloud IAM is the only real boundary**.

Firestore IAM for data access is granted at the **database** level, never the
collection level:

- The `datastore.entities.*` permissions are database-wide. The Firestore
  permission reference describes `datastore.entities.list` as "list the names of
  documents in a **project**" — there is no collection or document scope.
- `roles/datastore.user`'s documented *lowest-level resource where you can grant
  this role* is **Project**, and the same holds for custom roles.
- The only data scoping IAM offers is **per-*database***, through an IAM
  *condition* on a project-level binding
  (`resource.name == "projects/PROJECT_ID/databases/DATABASE_ID"`). Firestore has
  no collection-level IAM role; a feature request for one exists and is still
  open.

So, stated plainly:

1. A custom role can make the credential **less dangerous** — it cannot delete a
   document, and it cannot create/delete databases, change indexes, import,
   export, bulk-delete, restore or clone. It reduces risk but **does not isolate
   individual collections** within a database.
2. A separate database **does** isolate collections, because the isolation
   boundary is the database. With the collector writing only to `staging`, and
   the public `alerts` collection living only in `(default)`, an IAM condition on
   `projects/jntuh-notes-6ef74/databases/staging` gives an **IAM-enforced**
   guarantee that the collector credential cannot touch `alerts` — the part the
   custom role alone could never express.
3. The collection restriction also remains **application-level**:
   `assertCollection()` in [`lib/firestoreAdmin.mjs`](lib/firestoreAdmin.mjs)
   refuses any collection outside `ingestItems` / `ingestRuns` /
   `ingestSourceHealth` on every read and every mutation, and the store refuses
   any database other than `staging` (`resolveDatabaseId`). Treat both as defence
   in depth, never as the whole boundary.
4. The database split is implemented in code and configuration (see
   [Option B](#option-b-separate-staging-database) below) but is **not yet
   applied in Google Cloud**: the `staging` database does not exist until the
   owner creates it, and the IAM condition is not bound until the owner adds it.

## Option B: separate staging database

The public `alerts` collection, analytics, channels, settings and users stay in
the **`(default)`** database ([`../firestore.rules`](../firestore.rules)). The
collector's three staging collections live in a second named database,
**`staging`** ([`../firestore.staging.rules`](../firestore.staging.rules)).

What is checked in:

| Piece | Where | What it does |
| --- | --- | --- |
| Database list | [`../firebase.json`](../firebase.json) | `firebase deploy --only firestore:rules,firestore:indexes` now deploys each database's rules and indexes (`(default)` → `firestore.rules`; `staging` → `firestore.staging.rules`). |
| Pinned id | [`lib/runReport.mjs`](lib/runReport.mjs) `STAGING_DATABASE_ID` | The collector's single source of truth for "which database". `resolveDatabaseId()` returns only `"staging"` and throws for `(default)`, empty or any other value. |
| Store | [`lib/firestoreAdmin.mjs`](lib/firestoreAdmin.mjs) | `getFirestore(app, resolvedDatabaseId)` — an explicit named database, never the default, with a post-init `databaseId` mismatch check. |
| Run report | [`write.mjs`](write.mjs) / [`index.mjs`](index.mjs) | Every run document records `databaseId` so the audit trail says which database the run wrote to. |
| Policy | [`lib/runPolicy.mjs`](lib/runPolicy.mjs) | A staging run is pinned to `staging`; `COLLECTOR_DATABASE_ID` is an *assertion* and any value other than `"staging"` refuses the run. |
| Admin UI | [`../src/lib/ingest.js`](../src/lib/ingest.js) | Opens two handles from one app: `db` = `staging` for the ingest collections, `alertsDb` = `(default)` for the alert a promotion creates. |
| Promotion | [`../src/lib/ingest.js`](../src/lib/ingest.js) | Firestore has no cross-database transaction, so promotion is create-the-draft-first (deterministic id, create-if-absent, never overwrite) then claim-the-item-in-`staging`. A retry heals a half-finished promotion; a notice can never fork two alerts. |

### The emulator does not support multiple databases

The Firestore emulator (firebase-tools 15.34.0) prints *"Cloud Firestore
Emulator does not support multiple databases yet"* and the CLI loads **no**
rules at all when `firebase.json` lists more than one database. The workaround
the tests use, and its limits:

- [`../firebase.e2e.json`](../firebase.e2e.json) keeps a **single** firestore
  entry (so `emulators:exec` starts cleanly), and
  [`tests/rules/emulatorDb.mjs`](tests/rules/emulatorDb.mjs) loads each database's
  ruleset explicitly through the emulator's rules REST endpoint
  (`PUT /emulator/v1/projects/{p}/databases/{db}:securityRules`) and clears each
  database explicitly. The emulator *binary* does keep named databases separate
  and honours per-database rules; the tests exercise that real layout.
- If a future emulator drops named-database isolation or per-database rules, the
  rules tests **fail loudly** (a `allow`-expecting assertion sees
  `PERMISSION_DENIED`, or seeded documents are missing) rather than passing
  silently.
- Nothing about this workaround changes production: `firebase.json` (the deploy
  config) is the multi-database list; only the test config is single-entry.

## What the role grants, and why

Every permission is tied to an operation the collector actually performs. The
mapping comes from the *Required permissions for API methods* table in the
Firestore "Security for server client libraries" documentation.

| Collector operation | Code | Permission(s) |
| --- | --- | --- |
| Read staging documents by id (chunks of ≤ 300) | `db.getAll(...refs)` in `readStaging` | `datastore.entities.get` |
| Create or merge a staging document | `batch.set(ref, data, { merge: true })` in `commitMutations` | `datastore.entities.create`, `datastore.entities.update` |

## What the role deliberately excludes

| Not granted | Why |
| --- | --- |
| `datastore.entities.delete` | No collector planner ever emits a delete mutation. The single defensive `batch.delete` branch in `commitMutations` exists only to satisfy the store's contract and is unreachable from `write.mjs`/`index.mjs`. Without the permission that branch fails **closed** (`PERMISSION_DENIED`, recorded in the run report) instead of destroying data. |
| `datastore.entities.list` | The collector reads documents by id and never queries or lists. |
| `datastore.databases.get/list/create/update/delete`, `datastore.databases.bulkDelete`, `datastore.databases.import/export`, `datastore.schemas.*`, `datastore.operations.*`, `datastore.namespaces.*`, `datastore.statistics.*`, `datastore.backups*`, `datastore.backupSchedules*`, `resourcemanager.projects.*` | Administration, bulk data movement, backups and metadata. The collector uses none of them. |
| `roles/owner`, `roles/editor`, `roles/datastore.user`, `roles/datastore.owner`, `roles/datastore.bulkAdmin`, `roles/datastore.importExportAdmin`, `firebase.admin` | Primitive and predefined roles that are far broader than the operation surface above. The binding commands below never use them, and a test asserts that. |

## The role definition

This is the exact content of
[`iam/collector-staging-role.json`](iam/collector-staging-role.json); a test
fails if the two drift apart.

```json
{
  "title": "JNTUH alert collector - staging writer",
  "description": "Least-privilege Firestore data role for the JNTUH alert collector service account (collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com). It may read documents by id and create/update documents, which is exactly what the collector's staging write path does (db.getAll + batch.set with merge). It deliberately grants no datastore.entities.delete, no datastore.databases.*, no datastore.schemas.*, no datastore.operations.*, no import/export/bulk/backup/restore permission and no resourcemanager.projects.* permission. WARNING: Firestore IAM is database-granular, never collection-granular, so this role is scoped to the whole database; the three staging collections are enforced by the collector's own allowlist, not by this role. See collector/SECURITY.md.",
  "stage": "GA",
  "includedPermissions": [
    "datastore.entities.get",
    "datastore.entities.create",
    "datastore.entities.update"
  ]
}
```

## Creating the role (owner action, during the approved rollout)

```bash
# 1. create the project-level custom role from the checked-in definition
gcloud iam roles create jntuhCollectorStaging \
  --project=jntuh-notes-6ef74 \
  --file=collector/iam/collector-staging-role.json

# 2. bind it to the dedicated collector service account - and ONLY to staging
gcloud projects add-iam-policy-binding jntuh-notes-6ef74 \
  --member='serviceAccount:collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com' \
  --role='projects/jntuh-notes-6ef74/roles/jntuhCollectorStaging' \
  --condition='expression=resource.name=="projects/jntuh-notes-6ef74/databases/staging",title=staging-database-only'
```

The condition is **required**, not optional: do not also grant this service
account an unconditional binding for this role (or any broader Firestore role),
because that would bypass the database restriction. If an unconditional binding
was previously added, remove it before relying on this condition. The condition
is documented for REST/client-library access (which is what the Admin SDK uses)
and is ignored only by the Cloud console. A condition that does not match fails
**closed** (`PERMISSION_DENIED`), never as a silent write; if that happens,
check the database id in the condition first (`staging`, not `(default)`).

## Verifying it

```bash
# the role's exact contents
gcloud iam roles describe jntuhCollectorStaging --project=jntuh-notes-6ef74

# the service account's bindings: expect only the conditional custom-role grant
gcloud projects get-iam-policy jntuh-notes-6ef74 \
  --flatten="bindings[].members" \
  --filter="bindings.members:collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com" \
  --format="table(bindings.role,bindings.condition.expression)"
```

The `datastore.entities.get/create/update` permissions can also be confirmed with
`testIamPermissions` against the database resource (the effective set, after IAM
propagation). Either way the effective proof is the same: one staging run
succeeds, and an attempted delete or administrative call is denied. **IAM caches
permissions for up to 5 minutes**, so allow for that after any change.

## Permissions that still need verification

The three permissions are derived from the documented API-method → permission
table, not from a live staging run, because the Firestore **emulator does not
enforce IAM** and the rollout is not approved. Add a permission **only** if a
real staging run proves it necessary — the failure mode is fail-closed:

| Permission | Add it only if… |
| --- | --- |
| `datastore.entities.list` | a run ever performs a query instead of id lookups (it does not today). |
| `datastore.databases.get` | the SDK begins a transaction (the collector uses batches, not transactions). |

Do **not** add `datastore.entities.delete` to work around an error: a delete that
is denied is the boundary working.

## Creating the staging database and deploying its rules (owner action)

The `staging` database and the split rulesets are configuration in this
repository, not something this change applied. Before the first staging run the
owner must:

```bash
# 1. create the second Firestore database. `firebase firestore:databases:create`
#    is the CLI spelling; it must be a NATIVE Firestore database in the same
#    project and region as the app.
firebase firestore:databases:create staging \
  --project jntuh-notes-6ef74 \
  --location <the region of the (default) database>

# 2. deploy BOTH rulesets and BOTH index sets in one command (firebase.json
#    lists the two databases, so `test:rules`/CI can verify them too)
firebase deploy --only firestore:rules,firestore:indexes --project jntuh-notes-6ef74

# 3. move any existing staging documents from the old location into the new
#    database. The previous layout stored them in `(default)`; they are now
#    denied there, so any leftovers are invisible to the app until copied.
#    Copy them deliberately (a one-off script or the console) - do not rely on
#    the app to fall back.
```

Until step 1 is done, every collector write fails with `PERMISSION_DENIED` /
`NOT_FOUND` (fail closed) rather than landing anywhere unexpected, and until
step 2 is done the admin review UI (`/admin/ingest`) has nothing to read.

## Detective controls (recommended, independent of the role)

The role no longer needs to express "not the `alerts` collection" once the
condition pins it to `staging`, but detect any drift anyway:

- Enable **Firestore Data Access audit logs** for the project and add a
  log-based alert on writes by
  `collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com` (and specifically
  on any write whose resource is outside the three staging collections, once the
  log's resource shape is confirmed).
- Treat a `PERMISSION_DENIED` in a run report as a signal to investigate, not to
  widen the role.

## Residual risk

Without the database condition, the role alone still lets a leaked collector
credential read the **whole project** and read/write documents in any collection
of **any** database, including `alerts` in `(default)`. It cannot delete, and it
cannot perform database administration. The two mitigations are complementary:

- the **database split** (option B) confines the collector's code and the
  intended IAM scope to `staging`, and
- the **IAM condition** above turns that intention into an enforced boundary.

Apply both. Adopting Workload Identity Federation removes the long-lived
service-account key itself, and is the recommended long-term credential
([`SCHEDULING.md`](SCHEDULING.md)).
