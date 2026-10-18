// ---------------------------------------------------------------------------
// Local-only E2E seed/cleanup helper for the admin ingestion browser test.
//
// It talks EXCLUSIVELY to the local Firebase emulators (demo-* project) and
// writes synthetic data. It never contacts a real Firebase project, never reads
// a service-account key (emulator mode needs no credentials), and is not part of
// the app or the collector runtime.
//
//   node e2e/seed.mjs admin    # create/ensure the admin user + `admin: true` claim
//   node e2e/seed.mjs notices  # stage two synthetic notices through the real
//                              # collector write path (planRun + executeRun)
//   node e2e/seed.mjs alerts   # seed synthetic PUBLISHED alerts (plus one draft)
//                              # for the homepage "Latest alerts" section
//   node e2e/seed.mjs clear    # delete every document in the emulator
// ---------------------------------------------------------------------------

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { createIngestStore } from "../collector/lib/firestoreAdmin.mjs";
import { executeRun, itemIdsForSources, planRun } from "../collector/write.mjs";

const PROJECT_ID = "demo-jntuh-notes";
const FIRESTORE_HOST = "127.0.0.1:8080";
const AUTH_HOST = "127.0.0.1:9099";

// Emulator routing. Set explicitly so an ambient production value cannot leak in.
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const ADMIN_EMAIL = "e2e-admin@example.com";
const ADMIN_PASSWORD = "e2e-password-123";
const NONADMIN_EMAIL = "e2e-viewer@example.com";

const SOURCE_ID = "notifications";

const NOTICES = [
  {
    sourceId: SOURCE_ID,
    sourceName: "JNTUH Notifications",
    title: "B.Tech IV Year II Semester regular examination schedule (synthetic)",
    category: "exams",
    canonicalUrl: "https://jntuh.ac.in/uploads/notifications/e2e-exams-schedule.pdf",
    documentUrl: "https://jntuh.ac.in/uploads/notifications/e2e-exams-schedule.pdf",
    sourceUrl: "https://jntuh.ac.in/notifications",
    sourceUrlFallback: false,
    noticeDate: new Date("2026-10-01T00:00:00Z"),
    attachments: [],
    pane: null,
  },
  {
    sourceId: SOURCE_ID,
    sourceName: "JNTUH Notifications",
    title: "Revised tuition fee payment deadline for R22 students (synthetic)",
    category: "deadline",
    canonicalUrl: "https://jntuh.ac.in/uploads/notifications/e2e-fee-deadline.pdf",
    documentUrl: "https://jntuh.ac.in/uploads/notifications/e2e-fee-deadline.pdf",
    sourceUrl: "https://jntuh.ac.in/notifications",
    sourceUrlFallback: false,
    noticeDate: null,
    attachments: [],
    pane: null,
  },
];

const SOURCE_RESULT = {
  id: SOURCE_ID,
  name: "JNTUH Notifications",
  status: "ok",
  notices: NOTICES,
  duplicates: [],
  warnings: [],
  drafts: NOTICES.length,
  draftProblems: 0,
};

function makeStore() {
  return createIngestStore({
    projectId: PROJECT_ID,
    emulator: true,
    allowedProjects: [PROJECT_ID],
    env: { FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST },
    quiet: true,
  });
}

async function ensureAdmin() {
  const app = initializeApp({ projectId: PROJECT_ID }, "e2e-seed-auth");
  try {
    const auth = getAuth(app);
    let user;
    try {
      user = await auth.getUserByEmail(ADMIN_EMAIL);
    } catch {
      user = await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        emailVerified: true,
        displayName: "E2E Admin",
      });
    }
    await auth.setCustomUserClaims(user.uid, { admin: true });
    console.log(JSON.stringify({ ok: true, uid: user.uid, email: ADMIN_EMAIL }));
  } finally {
    await deleteApp(app);
  }
}

async function ensureNonAdmin() {
  const app = initializeApp({ projectId: PROJECT_ID }, "e2e-seed-auth");
  try {
    const auth = getAuth(app);
    let user;
    try {
      user = await auth.getUserByEmail(NONADMIN_EMAIL);
    } catch {
      user = await auth.createUser({
        email: NONADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        emailVerified: true,
        displayName: "E2E Viewer",
      });
    }
    // Explicitly no `admin` claim: a valid account that is NOT an administrator.
    await auth.setCustomUserClaims(user.uid, {});
    console.log(JSON.stringify({ ok: true, uid: user.uid, email: NONADMIN_EMAIL }));
  } finally {
    await deleteApp(app);
  }
}

async function stageNotices() {
  const store = makeStore();
  try {
    const runId = `e2e-${Date.now()}`;
    const { ids } = itemIdsForSources([SOURCE_RESULT]);
    const existingItems = await store.readItems(ids);
    const existingHealth = await store.readSourceHealth([SOURCE_ID]);
    const plan = planRun({
      sources: [SOURCE_RESULT],
      existingItems,
      existingHealth,
      runId,
      startedAt: new Date(),
      trigger: "manual",
      actor: "e2e-seed",
      dryRun: false,
      projectId: PROJECT_ID,
      maxItems: 10,
    });
    if (plan.refused) throw new Error(plan.refusalReason);
    await executeRun({ plan, store });
    console.log(JSON.stringify({ ok: true, runId, itemIds: [...ids] }));
  } finally {
    await store.close();
  }
}

async function clearAll() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  console.log(JSON.stringify({ ok: res.ok, status: res.status }));
}

// --- homepage "Latest alerts" fixtures --------------------------------------
//
// Synthetic notices for the public homepage section (Alert Radar data), all
// clearly labelled "(synthetic)". Five are PUBLISHED - one pinned and one
// older than the homepage's limit - so a driven browser can check ordering,
// the 4-card cap and that the sixth, a draft, never appears. Admin-SDK writes
// bypass security rules, so the emulator is seeded with documents that are
// valid under firestore.rules (the real rules are still applied to browser
// reads).

const ALERT_COLLECTION = "alerts";
const ALERT_ACTOR = "e2e-admin@example.com";

function publishedAlert({
  title,
  summary,
  category,
  publishedAt,
  deadlineAt = null,
  pinned = false,
}) {
  const at = (value) => Timestamp.fromDate(new Date(value));
  return {
    title: `${title} (synthetic)`,
    summary,
    category,
    sourceName: "JNTUH Notifications",
    sourceUrl: "https://jntuh.ac.in/notifications",
    publishedAt: at(publishedAt),
    deadlineAt: deadlineAt ? at(deadlineAt) : null,
    status: "published",
    pinned,
    audience: [],
    tags: [],
    verifiedAt: at(publishedAt),
    verifiedBy: ALERT_ACTOR,
    createdBy: ALERT_ACTOR,
    updatedBy: ALERT_ACTOR,
    createdAt: at(publishedAt),
    updatedAt: at(publishedAt),
    schemaVersion: 1,
  };
}

const SEED_ALERTS = [
  {
    id: "e2e-alert-deadline",
    doc: publishedAlert({
      title: "Revised tuition fee payment deadline for R22 students",
      summary: "The last date to pay the semester fee without a late fee.",
      category: "deadline",
      publishedAt: "2026-10-05T00:00:00Z",
      deadlineAt: "2026-10-09T00:00:00Z",
    }),
  },
  {
    id: "e2e-alert-exams",
    doc: publishedAlert({
      title: "B.Tech IV Year II Semester regular examination schedule",
      summary: "Subject-wise dates for the end-semester examinations.",
      category: "exams",
      publishedAt: "2026-10-03T00:00:00Z",
    }),
  },
  {
    id: "e2e-alert-pinned",
    doc: publishedAlert({
      title: "Academic calendar for the next semester",
      summary: "Term dates, holidays and internal assessment weeks.",
      category: "calendar",
      publishedAt: "2026-09-28T00:00:00Z",
      pinned: true,
    }),
  },
  {
    id: "e2e-alert-results",
    doc: publishedAlert({
      title: "III Year I Semester results declared",
      summary: "Results are available on the examinations portal.",
      category: "results",
      publishedAt: "2026-09-25T00:00:00Z",
    }),
  },
  {
    id: "e2e-alert-older",
    doc: publishedAlert({
      title: "Older notice outside the homepage limit",
      summary: "This one is published but falls past the 4-card cap.",
      category: "general",
      publishedAt: "2026-09-12T00:00:00Z",
    }),
  },
  {
    id: "e2e-alert-draft",
    doc: {
      ...publishedAlert({
        title: "Unpublished draft that must stay private",
        summary: "Not verified or published - must never reach the public UI.",
        category: "general",
        publishedAt: "2026-10-10T00:00:00Z",
      }),
      status: "draft",
      verifiedAt: null,
      verifiedBy: "",
    },
  },
];

async function seedAlerts() {
  const app = initializeApp({ projectId: PROJECT_ID }, "e2e-seed-alerts");
  try {
    const db = getFirestore(app);
    const batch = db.batch();
    for (const { id, doc } of SEED_ALERTS) {
      batch.set(db.collection(ALERT_COLLECTION).doc(id), doc);
    }
    await batch.commit();
    console.log(
      JSON.stringify({
        ok: true,
        alerts: SEED_ALERTS.map(({ id, doc }) => ({
          id,
          status: doc.status,
          pinned: doc.pinned,
          publishedAt: doc.publishedAt?.toDate().toISOString(),
        })),
      })
    );
  } finally {
    await deleteApp(app);
  }
}

const command = process.argv[2];
if (command === "admin") await ensureAdmin();
else if (command === "nonadmin") await ensureNonAdmin();
else if (command === "notices") await stageNotices();
else if (command === "alerts") await seedAlerts();
else if (command === "clear") await clearAll();
else {
  console.error("usage: node e2e/seed.mjs <admin|nonadmin|notices|alerts|clear>");
  process.exit(1);
}
