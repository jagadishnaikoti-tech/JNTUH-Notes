import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Client-side guard for pages that require a signed-in student.
 *
 * This is a UX guard only - it decides what to render. Real protection lives in
 * Firebase Authentication and the Firestore security rules; nothing here is
 * treated as a security boundary.
 *
 * The requested location is preserved in `?next=` (validated on the way back)
 * so the visitor returns to it after signing in.
 */
export default function ProtectedRoute({ children }) {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main className="page-main">
        <div className="auth-layout">
          <p className="auth-loading-line" role="status">
            Loading your account…
          </p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }

  return children;
}
