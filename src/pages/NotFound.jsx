import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="page-main">
      <div className="empty-state" role="alert">
        <span className="empty-state-icon" aria-hidden="true">
          <Compass size={28} />
        </span>
        <h1 style={{ margin: 0 }}>Page not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          The page you are looking for does not exist on this website.
        </p>
        <div className="row-center mt-md">
          <Link className="btn btn-primary" to="/">
            <Home size={16} aria-hidden="true" />
            Go Home
          </Link>
          <Link className="btn btn-ghost" to="/years">
            Browse subjects
          </Link>
        </div>
      </div>
    </main>
  );
}
