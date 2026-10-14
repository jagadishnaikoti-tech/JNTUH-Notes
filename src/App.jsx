import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import SearchShortcut from "./components/SearchShortcut.jsx";
import { SidebarProvider, useSidebar } from "./components/SidebarContext.jsx";
import { ModalProvider } from "./components/ModalContext.jsx";
import { ToastProvider } from "./components/ToastContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import ScrollToTop from "./components/ScrollToTop.jsx";
import PageViewTracker from "./components/analytics/PageViewTracker.jsx";
import PdfClickTracker from "./components/analytics/PdfClickTracker.jsx";
import ConsentBanner from "./components/analytics/ConsentBanner.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Home from "./pages/Home.jsx";
import YearSelect from "./pages/YearSelect.jsx";
import YearSubjects from "./pages/YearSubjects.jsx";
import LearnCode from "./pages/LearnCode.jsx";
import SubjectPage from "./pages/SubjectPage.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import QuestionsPage from "./pages/QuestionsPage.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import TermsConditions from "./pages/TermsConditions.jsx";
import SiteMap from "./pages/SiteMap.jsx";
import SignIn from "./pages/SignIn.jsx";
import SignUp from "./pages/SignUp.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import Account from "./pages/Account.jsx";
import NotFound from "./pages/NotFound.jsx";
import { applyRouteHead } from "./lib/head.js";

// The whole admin area (and the Firebase Auth/Firestore SDKs it needs) is code
// split, so public visitors never download it.
const AdminApp = lazy(() => import("./pages/admin/AdminApp.jsx"));

function Layout() {
  const { pathname } = useLocation();
  const { collapsed, mobileOpen } = useSidebar();

  // Keep every SEO-relevant <head> tag accurate per route (title, description,
  // robots, canonical, Open Graph, Twitter and JSON-LD).
  useEffect(() => {
    applyRouteHead(pathname);
  }, [pathname]);

  const shellClass =
    "app-shell" +
    (collapsed ? " is-collapsed" : "") +
    (mobileOpen ? " is-mobile-open" : "");

  return (
    <div className={shellClass}>
      <ScrollToTop />
      <SearchShortcut />
      {/* First-party analytics: page views + PDF click tracking (public only). */}
      <PageViewTracker />
      <PdfClickTracker />
      <Sidebar />
      <div className="app-main">
        <Header />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
      <ConsentBanner />
    </div>
  );
}

// The public shell owns the student auth provider. The admin area is mounted
// outside it, so its own (separate) auth provider is unaffected.
function PublicLayout() {
  return (
    <AuthProvider>
      <Layout />
    </AuthProvider>
  );
}

function AdminFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-mark" aria-hidden="true">
        <Loader2 size={24} />
      </span>
      Loading administration…
    </div>
  );
}

export default function App() {
  return (
    <ModalProvider>
      <ToastProvider>
        <SidebarProvider>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/years" element={<YearSelect />} />
              <Route path="/year/:yearId" element={<YearSubjects />} />
              <Route path="/code" element={<LearnCode />} />
              <Route path="/subject/:groupId/:folderId" element={<SubjectPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/questions/:category" element={<QuestionsPage />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-and-conditions" element={<TermsConditions />} />
              <Route path="/sitemaps" element={<SiteMap />} />

              {/* Student authentication */}
              <Route path="/signin" element={<SignIn />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/account"
                element={
                  <ProtectedRoute>
                    <Account />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Route>

            {/* Admin area - fully separate from the public layout and chrome. */}
            <Route
              path="/admin/*"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminApp />
                </Suspense>
              }
            />
          </Routes>
        </SidebarProvider>
      </ToastProvider>
    </ModalProvider>
  );
}
