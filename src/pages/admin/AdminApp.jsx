import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "../../components/admin/AdminAuthContext.jsx";
import RequireAdmin from "../../components/admin/RequireAdmin.jsx";
import AdminLayout from "../../components/admin/AdminLayout.jsx";
import AdminLogin from "./AdminLogin.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import AdminAnalytics from "./AdminAnalytics.jsx";
import AdminPdfActivity from "./AdminPdfActivity.jsx";
import AdminChannels from "./AdminChannels.jsx";
import AdminAlerts from "./AdminAlerts.jsx";
import AdminIngest from "./AdminIngest.jsx";

/** Keep the admin area out of search engines while it is mounted. */
function useAdminHead() {
  useEffect(() => {
    let meta = document.head.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
  }, []);
}

/**
 * Entire admin area. Loaded lazily from App.jsx so none of this code - or the
 * Firebase Auth/Firestore SDKs it pulls in - is part of the public bundle.
 */
export default function AdminApp() {
  useAdminHead();

  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<AdminLogin />} />
        <Route element={<RequireAdmin />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="pdf-activity" element={<AdminPdfActivity />} />
            <Route path="channels" element={<AdminChannels />} />
            <Route path="alerts" element={<AdminAlerts />} />
            <Route path="ingest" element={<AdminIngest />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
