import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
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
import NotFound from "./pages/NotFound.jsx";

function Layout() {
  const { pathname } = useLocation();
  const { collapsed, mobileOpen } = useSidebar();

  useEffect(() => {
    document.title =
      pathname === "/"
        ? "LECTURE NOTES | B.Tech CSE & AIML Study Material"
        : "LECTURE NOTES";
  }, [pathname]);

  const shellClass =
    "app-shell" +
    (collapsed ? " is-collapsed" : "") +
    (mobileOpen ? " is-mobile-open" : "");

  return (
    <div className={shellClass}>
      <ScrollToTop />
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </SidebarProvider>
      </ToastProvider>
    </ModalProvider>
  );
}
