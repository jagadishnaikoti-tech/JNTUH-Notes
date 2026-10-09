import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);

/**
 * Minimal, accessible transient-message provider. Used for inline feedback such
 * as the "signed out" notice that the original navbar surfaced.
 */
export function ToastProvider({ children }) {
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  const showToast = useCallback((msg) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 6000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const value = useMemo(() => showToast, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message ? (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
