// ---------------------------------------------------------------------------
// E2E-ONLY browser entry. NOT part of the production bundle.
//
// It mounts the REAL app (src/App.jsx -> the real admin area) but first wires
// the shared Firebase bootstrap to the LOCAL emulator suite, so a driven
// browser exercises the actual UI under the actual firestore.rules.
//
// Run:  vite --mode e2e
// Load: http://127.0.0.1:5173/e2e/harness.html?path=/admin/ingest
//
// Safety: it hard-refuses any project id other than the local `demo-*` project,
// so it can never be pointed at production by a stray env value.
// ---------------------------------------------------------------------------

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  firebaseConfig,
  getFirebaseApp,
  loadAuth,
  loadFirestore,
} from "../src/lib/firebase.js";

const DEMO_PROJECT = "demo-jntuh-notes";
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8080;
const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";

if (firebaseConfig.projectId !== DEMO_PROJECT) {
  throw new Error(
    `E2E harness refuses project "${firebaseConfig.projectId}"; expected "${DEMO_PROJECT}".`
  );
}

// Render a real browser-router path (not a separate route) so route guards and
// redirects behave exactly as in the deployed app.
const target =
  new URLSearchParams(window.location.search).get("path") || "/admin/ingest";
window.history.replaceState(null, "", target);

const app = await getFirebaseApp();
if (!app) {
  throw new Error("E2E harness could not initialise Firebase (missing VITE_FIREBASE_*).");
}

const { getFirestore, connectFirestoreEmulator } = await loadFirestore();
connectFirestoreEmulator(getFirestore(app), FIRESTORE_HOST, FIRESTORE_PORT);

const { getAuth, connectAuthEmulator } = await loadAuth();
connectAuthEmulator(getAuth(app), AUTH_EMULATOR_URL, { disableWarnings: true });

window.__e2e = {
  projectId: firebaseConfig.projectId,
  firestore: `${FIRESTORE_HOST}:${FIRESTORE_PORT}`,
  auth: AUTH_EMULATOR_URL,
  path: target,
};

const { default: App } = await import("../src/App.jsx");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
