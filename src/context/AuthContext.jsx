import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  observeStudentAuth,
  reloadStudent,
  resendVerificationEmail,
  sendPasswordReset,
  signInStudent,
  signOutStudent,
  signUpStudent,
  updateStudentDisplayName,
} from "../lib/userAuth.js";
import { loadUserProfile } from "../lib/userProfile.js";

/**
 * Public (student) authentication state.
 *
 * Mounted once around the public layout, so the whole site sees the same
 * session. The admin area has its own provider and is unaffected by this one.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null });
  const [profile, setProfile] = useState(null);
  // Locally applied display name. Firebase's updateProfile() mutates the User
  // object in place, so relying on object identity alone would not re-render.
  const [localName, setLocalName] = useState("");

  useEffect(() => observeStudentAuth(setState), []);

  const uid = state.user?.uid || null;

  // Reset the locally applied name whenever the signed-in identity changes.
  useEffect(() => {
    setLocalName("");
  }, [uid]);

  // Keep the Firestore profile in step with the signed-in user. Best-effort:
  // a missing profile simply falls back to the Auth display name/email.
  useEffect(() => {
    let active = true;
    if (state.status === "signed-in" && uid) {
      loadUserProfile(uid)
        .then((data) => {
          if (active) setProfile(data);
        })
        .catch(() => {});
    } else {
      setProfile(null);
    }
    return () => {
      active = false;
    };
  }, [state.status, uid]);

  const value = useMemo(() => {
    const user = state.user || null;
    const name = (localName || user?.displayName || profile?.displayName || "").trim();
    const displayName =
      name || (user?.email ? user.email.split("@")[0] : "");
    return {
      status: state.status,
      user,
      profile,
      loading: state.status === "loading",
      configured: state.status !== "unconfigured",
      isAuthenticated: state.status === "signed-in",
      displayName,
      initial: (displayName || user?.email || "?").trim().charAt(0).toUpperCase(),
      signIn: signInStudent,
      signUp: signUpStudent,
      signOut: signOutStudent,
      sendPasswordReset,
      resendVerificationEmail,
      updateDisplayName: async (target, next) => {
        const saved = await updateStudentDisplayName(target, next);
        setLocalName(saved);
        return saved;
      },
      reload: reloadStudent,
    };
  }, [state, profile, localName]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
