import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { KeyRound, LogIn, Mail } from "lucide-react";
import {
  AuthInput,
  AuthMessage,
  AuthPage,
  AuthSubmit,
} from "../components/AuthForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  authErrorMessage,
  isValidEmail,
  safeNext,
} from "../lib/userAuth.js";

export default function SignIn() {
  const { status, isAuthenticated, configured, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "/account");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // Already signed in (including after a reload with a saved session).
  if (isAuthenticated) return <Navigate to={next} replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = {};
    if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await signIn({ email, password, remember });
      navigate(next, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <AuthPage title="Sign in">
        <p className="auth-loading-line" role="status">
          Checking your session…
        </p>
      </AuthPage>
    );
  }

  const signedOutForSecurity = location.state?.reason === "session";

  return (
    <AuthPage
      title="Sign in"
      subtitle="Access your JNTUH Notes account to keep your study tools in one place."
    >
      {signedOutForSecurity ? (
        <AuthMessage tone="info">
          Your session has ended. Please sign in again to continue.
        </AuthMessage>
      ) : null}

      {!configured ? (
        <AuthMessage tone="error">
          Sign-in is not available right now because the site is not connected to
          its authentication service.
        </AuthMessage>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <AuthMessage>{error}</AuthMessage> : null}

          <AuthInput
            id="signin-email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@example.com"
            error={fieldErrors.email}
            disabled={submitting}
            required
          />

          <AuthInput
            id="signin-password"
            label="Password"
            icon={KeyRound}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Your password"
            error={fieldErrors.password}
            disabled={submitting}
            reveal
            required
          />

          <div className="auth-form-row">
            <label className="auth-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={submitting}
              />
              <span>Keep me signed in</span>
            </label>
            <Link className="auth-inline-link" to="/forgot-password">
              Forgot password?
            </Link>
          </div>

          <AuthSubmit
            submitting={submitting}
            loadingChildren="Signing in…"
            icon={LogIn}
          >
            Sign in
          </AuthSubmit>
        </form>
      )}

      <p className="auth-alt">
        New to JNTUH Notes? <Link to="/signup">Create an account</Link>
      </p>
    </AuthPage>
  );
}
