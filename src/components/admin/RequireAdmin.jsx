import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ShieldAlert, ServerCrash } from "lucide-react";
import { useAdmin } from "./AdminAuthContext.jsx";
import { Spinner } from "./adminUi.jsx";

function Notice({ icon: Icon, title, children }) {
  return (
    <div className="admin-centered">
      <div className="admin-notice">
        <Icon size={28} aria-hidden="true" />
        <h1>{title}</h1>
        <div className="admin-notice-body">{children}</div>
      </div>
    </div>
  );
}

/** Route guard: only administrators with the `admin` claim may pass. */
export default function RequireAdmin() {
  const { status } = useAdmin();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="admin-centered">
        <Spinner label="Checking administrator access…" />
      </div>
    );
  }

  if (status === "unconfigured") {
    return (
      <Notice icon={ServerCrash} title="Firebase is not configured">
        <p>
          Add the <code>VITE_FIREBASE_*</code> environment variables (see{" "}
          <code>.env.example</code> and <code>docs/ADMIN_SETUP.md</code>), then
          redeploy. The public website keeps working without them.
        </p>
      </Notice>
    );
  }

  if (status === "signed-out" || status === "forbidden") {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: location.pathname, reason: status }}
      />
    );
  }

  return <Outlet />;
}
