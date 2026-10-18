# Collector security boundary (Firestore IAM)

**Status: documented and configured as code — NOT applied.** The role definition
in [`iam/collector-staging-role.json`](iam/collector-staging-role.json) is
checked in so it can be reviewed, tested and applied deliberately. This change
created **no** Google Cloud IAM binding, **no** credential and **no** production
data. The commands below are owner actions, listed for the approved rollout in
[`SCHEDULING.md`](SCHEDULING.md).

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
   individual collections**, and it **cannot make the collector "staging-only"**
   at the IAM layer.
2. With this role, a leaked collector credential could still **read the whole
   database** and **write to any collection in that database, including
   `alerts`** (it could write a document the public site would treat as a
   published alert, because the Admin SDK bypasses both the collector's
   drafting guard and `firestore.rules`). It could not delete anything.
3. The collection restriction therefore remains **application-level**:
   `assertCollection()` in [`lib/firestoreAdmin.mjs`](lib/firestoreAdmin.mjs)
   refuses any collection outside `ingestItems` / `ingestRuns` /
   `ingestSourceHealth` on every read and every mutation. Treat that as defence
   in depth, never as IAM isolation.
4. The only way to get an **IAM-enforced** guarantee that the collector cannot
   reach `alerts` is to move the three staging collections into a **separate
   Firestore database** and grant this role only on that database. That is a
   larger migration (the emulator does not support multiple databases) and has
   **not** been done.

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

# 2. bind it to the dedicated collector service account - and ONLY it
gcloud projects add-iam-policy-binding jntuh-notes-6ef74 \
  --member='serviceAccount:collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com' \
  --role='projects/jntuh-notes-6ef74/roles/jntuhCollectorStaging'
```

Optional extra hardening — pin the service account to the default database, so a
future second database is unreachable. The condition is documented for
REST/client-library access (which is what the Admin SDK uses) and is ignored only
by the Cloud console:

```bash
gcloud projects add-iam-policy-binding jntuh-notes-6ef74 \
  --member='serviceAccount:collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com' \
  --role='projects/jntuh-notes-6ef74/roles/jntuhCollectorStaging' \
  --condition='expression=resource.name=="projects/jntuh-notes-6ef74/databases/(default)",title=default-database-only'
```

Verify it with one staging run. A condition that does not match fails **closed**
(`PERMISSION_DENIED`), never as a silent write; if that happens, drop the
condition and keep the role alone as the change.

## Verifying it

```bash
# the role's exact contents
gcloud iam roles describe jntuhCollectorStaging --project=jntuh-notes-6ef74

# the service account's bindings: expect exactly one row, the custom role
gcloud projects get-iam-policy jntuh-notes-6ef74 \
  --flatten="bindings[].members" \
  --filter="bindings.members:collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com" \
  --format="table(bindings.role)"
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

## Detective controls (recommended, independent of the role)

The role cannot express "not the `alerts` collection", so detect it:

- Enable **Firestore Data Access audit logs** for the project and add a
  log-based alert on writes by
  `collector-runner@jntuh-notes-6ef74.iam.gserviceaccount.com` (and specifically
  on any write whose resource is outside the three staging collections, once the
  log's resource shape is confirmed).
- Treat a `PERMISSION_DENIED` in a run report as a signal to investigate, not to
  widen the role.

## Residual risk

With this role, a leaked collector credential (service-account key) can read the
whole database and read/write documents in any collection of it, including
`alerts`. It cannot delete, and it cannot perform database administration.
Adopting Workload Identity Federation removes the long-lived key itself, and is
the recommended long-term credential ([`SCHEDULING.md`](SCHEDULING.md)).
