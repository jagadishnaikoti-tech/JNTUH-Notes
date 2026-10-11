import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, User, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import "../styles/auth.css";

/**
 * Authentication controls shown in the site chrome.
 *
 *  - variant="header"  : compact control for the top bar
 *  - variant="sidebar" : full-width block in the sidebar / mobile drawer
 *
 * While Firebase resolves the session nothing is shown, so a signed-in visitor
 * never briefly sees "Sign in" (and vice-versa). Rendering the sign-out control
 * updates automatically when auth state changes.
 */
export default function AuthNav({ variant = "header" }) {
  const { status, isAuthenticated, displayName, initial, user, signOut } =
    useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const firstItemRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    try {
      await signOut();
    } finally {
      // Return to a public page; the auth listener updates the chrome.
      navigate("/", { replace: true });
    }
  }

  // --- Loading: render a neutral placeholder to avoid layout shift ---------
  if (status === "loading") {
    return (
      <span
        className={`auth-nav auth-nav-${variant} auth-nav-loading`}
        aria-hidden="true"
      />
    );
  }

  // --- Signed out (or Firebase not configured) -----------------------------
  if (!isAuthenticated) {
    if (variant === "sidebar") {
      return (
        <div className="auth-side-block">
          <p className="auth-side-label">Your account</p>
          <Link className="auth-side-link" to="/signin">
            <LogIn size={16} aria-hidden="true" />
            <span>Sign in</span>
          </Link>
          <Link className="auth-side-link auth-side-link-cta" to="/signup">
            <UserPlus size={16} aria-hidden="true" />
            <span>Create account</span>
          </Link>
        </div>
      );
    }

    return (
      <div className="auth-nav auth-nav-header">
        <Link className="auth-nav-link" to="/signin">
          <LogIn size={16} aria-hidden="true" />
          <span className="auth-nav-label">Sign in</span>
        </Link>
        <Link className="auth-nav-cta" to="/signup">
          Create account
        </Link>
      </div>
    );
  }

  // --- Signed in -----------------------------------------------------------
  if (variant === "sidebar") {
    return (
      <div className="auth-side-block auth-side-user">
        <p className="auth-side-label">Signed in</p>
        <span className="auth-side-identity">
          <span className="auth-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="auth-side-id">
            <strong>{displayName}</strong>
            <span>{user?.email}</span>
          </span>
        </span>
        <Link className="auth-side-link" to="/account">
          <User size={16} aria-hidden="true" />
          <span>My account</span>
        </Link>
        <button
          type="button"
          className="auth-side-link"
          onClick={handleSignOut}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <div className="auth-nav auth-nav-header" ref={menuRef}>
      <button
        type="button"
        className="auth-account"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
      >
        <span className="auth-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="auth-account-name">{displayName}</span>
      </button>

      {open ? (
        <div className="auth-dropdown" role="menu" aria-label="Account">
          <div className="auth-dropdown-head">
            <span className="auth-avatar auth-avatar-lg" aria-hidden="true">
              {initial}
            </span>
            <span className="auth-dropdown-id">
              <strong>{displayName}</strong>
              <span>{user?.email}</span>
            </span>
          </div>
          <Link
            role="menuitem"
            to="/account"
            className="auth-dropdown-item"
            ref={firstItemRef}
            onClick={() => setOpen(false)}
          >
            <User size={15} aria-hidden="true" />
            My account
          </Link>
          <button
            type="button"
            role="menuitem"
            className="auth-dropdown-item"
            onClick={handleSignOut}
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
