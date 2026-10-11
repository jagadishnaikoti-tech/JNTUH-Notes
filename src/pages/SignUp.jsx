import { useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { KeyRound, Mail, ShieldCheck, User, UserPlus } from "lucide-react";
import {
  AuthInput,
  AuthMessage,
  AuthPage,
  AuthSubmit,
} from "../components/AuthForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  MIN_PASSWORD_LENGTH,
  MAX_NAME_LENGTH,
  authErrorMessage,
  isValidEmail,
  passwordStrength,
  safeNext,
} from "../lib/userAuth.js";

const STRENGTH_STEPS = 4;

export default function SignUp() {
  const { status, isAuthenticated, configured, signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "/account");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  if (isAuthenticated) return <Navigate to={next} replace />;

  if (status === "loading") {
    return (
      <AuthPage title="Create your account">
        <p className="auth-loading-line" role="status">
          Checking your session…
        </p>
      </AuthPage>
    );
  }

  const strength = passwordStrength(password);

  function validate() {
    const errors = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (!cleanName) errors.name = "Enter your full name.";
    else if (cleanName.length < 2) errors.name = "That name looks too short.";
    else if (cleanName.length > MAX_NAME_LENGTH)
      errors.name = `Use at most ${MAX_NAME_LENGTH} characters.`;

    if (!cleanEmail) errors.email = "Enter your email address.";
    else if (!isValidEmail(cleanEmail)) errors.email = "Enter a valid email address.";

    if (!password) errors.password = "Choose a password.";
    else if (password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

    if (!confirm) errors.confirm = "Re-enter your password.";
    else if (confirm !== password) errors.confirm = "The two passwords do not match.";

    return { errors, cleanName, cleanEmail };
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const { errors, cleanName, cleanEmail } = validate();
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await signUp({ name: cleanName, email: cleanEmail, password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage
      title="Create your account"
      subtitle="Free to use. Reading and downloading notes never requires an account — signing in just keeps your account details in one place."
    >
      {!configured ? (
        <AuthMessage tone="error">
          Account creation is not available right now because the site is not
          connected to its authentication service.
        </AuthMessage>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <AuthMessage>{error}</AuthMessage> : null}

          <AuthInput
            id="signup-name"
            label="Full name"
            icon={User}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Your name"
            error={fieldErrors.name}
            disabled={submitting}
            required
          />

          <AuthInput
            id="signup-email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            error={fieldErrors.email}
            disabled={submitting}
            required
          />

          <div>
            <AuthInput
              id="signup-password"
              label="Password"
              icon={KeyRound}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              hint={`Use at least ${MIN_PASSWORD_LENGTH} characters. A mix of upper case, lower case, numbers and symbols is stronger.`}
              error={fieldErrors.password}
              disabled={submitting}
              reveal
              required
            />
            {password ? (
              <div className="auth-strength" aria-hidden="true">
                <span className="auth-strength-bars">
                  {Array.from({ length: STRENGTH_STEPS }).map((_, i) => (
                    <span
                      key={i}
                      className={
                        "auth-strength-bar" +
                        (i < strength.score ? ` is-on level-${strength.score}` : "")
                      }
                    />
                  ))}
                </span>
                <span className="auth-strength-label">{strength.label}</span>
              </div>
            ) : null}
          </div>

          <AuthInput
            id="signup-confirm"
            label="Confirm password"
            icon={ShieldCheck}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            error={fieldErrors.confirm}
            disabled={submitting}
            reveal
            required
          />

          <p className="auth-terms">
            By creating an account you agree to our{" "}
            <Link to="/terms-and-conditions">Terms &amp; Conditions</Link> and{" "}
            <Link to="/privacy-policy">Privacy Policy</Link>.
          </p>

          <AuthSubmit
            submitting={submitting}
            loadingChildren="Creating account…"
            icon={UserPlus}
          >
            Create account
          </AuthSubmit>
        </form>
      )}

      <p className="auth-alt">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </AuthPage>
  );
}
