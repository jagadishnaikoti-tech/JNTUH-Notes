import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { observeAuth } from "../../lib/adminAuth.js";

const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null });

  useEffect(() => observeAuth(setState), []);

  const value = useMemo(
    () => ({ ...state, isAdmin: state.status === "admin" }),
    [state]
  );

  return (
    <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdmin must be used inside AdminAuthProvider");
  return ctx;
}
