import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  BookOpen,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useAdmin } from "../../components/admin/AdminAuthContext.jsx";
import { signInAdmin, signOutAdmin } from "../../lib/adminAuth.js";
import "../../styles/admin.css";

const MESSAGES = {
  forbidden: "That account is not an authorized administrator.",
};

export default function AdminLogin() {
  const { status } = useAdmin();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(() => MESSAGES[location.state?.reason] || "");
  const emailRef = useRef(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // A signed-in account without the admin claim must be told, then signed out
  // so the panel is not left in a half-authenticated state.
  useEffect(() => {
    if (status === "forbidden") {
      setError(MESSAGES.forbidden);
      signOutAdmin().catch(() => {});
    }
  }, [status]);

  if (status === "admin") {
    return <Navigate to={location.state?.from || "/admin/dashboard"} replace />;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signInAdmin(email.trim(), password);
      // onAuthStateChanged resolves the claim; the guard above then redirects.
    } catch (err) {
      const friendly = {
        "auth/invalid-email": "That email address is not valid.",
        "auth/missing-password": "Please enter your password.",
        "auth/user-disabled": "This account has been disabled.",
        "auth/user-not-found": "No account found for that email.",
        "auth/wrong-password": "Incorrect email or password.",
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/too-many-requests": "Too many attempts. Please wait and try again.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/operation-not-allowed":
          "Email/password sign-in is not enabled for this project.",
        "auth/configuration-not-found":
          "Email/password sign-in is not set up yet. Enable it in the Firebase console (Authentication → Sign-in method).",
        "auth/invalid-api-key":
          "The Firebase API key is not valid for this project.",
      };
      setError(friendly[err?.code] || "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const unconfigured = status === "unconfigured";

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <Link className="admin-login-brand" to="/" title="Back to JNTUH Notes">
          <span className="admin-login-mark" aria-hidden="true">
            <BookOpen size={20} />
          </span>
          <span className="admin-login-brand-text">
            <strong>JNTUH Notes</strong>
            <em>Administration</em>
          </span>
        </Link>

        <h1 className="admin-login-title">Administrator sign in</h1>
        <p className="admin-login-sub">
          Authorized staff only. Accounts are created in the Firebase console —
          there is no public sign-up.
        </p>

        {status === "unconfigured" ? (
          <p className="admin-alert" role="alert">
            <ShieldAlert size={16} aria-hidden="true" />
            Firebase is not configured. Add the <code>VITE_FIREBASE_*</code>{" "}
            environment variables and redeploy.
          </p>
        ) : (
          <form className="admin-form" onSubmit={onSubmit} noValidate>
            {error ? (
              <p className="admin-form-error" role="alert">
                <ShieldAlert size={16} aria-hidden="true" />
                {error}
              </p>
            ) : null}

            <label className="admin-field">
              <span className="admin-field-label">
                <Mail size={14} aria-hidden="true" /> Email
              </span>
              <input
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                disabled={submitting}
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">
                <KeyRound size={14} aria-hidden="true" /> Password
              </span>
              <span className="admin-input-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="admin-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <button
              type="submit"
              className="admin-submit"
              disabled={submitting || !email || !password}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="admin-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock size={16} aria-hidden="true" />
                  Sign in
                </>
              )}
            </button>
          </form>
        )}

        <p className="admin-login-foot">
          <Link to="/">← Back to JNTUH Notes</Link>
          <span className="admin-secure">
            <ShieldCheck size={13} aria-hidden="true" /> Secured by Firebase
            Authentication
          </span>
        </p>
      </div>
    </div>
  );
}
