import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import SearchShortcut from "./components/SearchShortcut.jsx";
import { SidebarProvider, useSidebar } from "./components/SidebarContext.jsx";
import { ModalProvider } from "./components/ModalContext.jsx";
import { ToastProvider } from "./components/ToastContext.jsx";
import ScrollToTop from "./components/ScrollToTop.jsx";
import Home from "./pages/Home.jsx";
import YearSelect from "./pages/YearSelect.jsx";
import YearSubjects from "./pages/YearSubjects.jsx";
import LearnCode from "./pages/LearnCode.jsx";
import SubjectPage from "./pages/SubjectPage.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import QuestionsPage from "./pages/QuestionsPage.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import TermsConditions from "./pages/TermsConditions.jsx";
import NotFound from "./pages/NotFound.jsx";
import { applyRouteHead } from "./lib/head.js";

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
      <Sidebar />
      <div className="app-main">
        <Header />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ModalProvider>
      <ToastProvider>
        <SidebarProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/years" element={<YearSelect />} />
              <Route path="/year/:yearId" element={<YearSubjects />} />
              <Route path="/code" element={<LearnCode />} />
              <Route path="/subject/:groupId/:folderId" element={<SubjectPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/questions/:category" element={<QuestionsPage />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-and-conditions" element={<TermsConditions />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </SidebarProvider>
      </ToastProvider>
    </ModalProvider>
  );
}
