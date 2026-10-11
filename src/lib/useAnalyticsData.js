import { useCallback, useEffect, useState } from "react";
import { aggregate, fetchEvents } from "./analyticsQuery.js";

/**
 * Loads and aggregates analytics events for a range. Returns
 * { loading, error, events, stats, reload }.
 */
export function useAnalyticsData(range) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    events: [],
    stats: null,
  });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchEvents(range)
      .then((events) => {
        if (!active) return;
        setState({ loading: false, error: null, events, stats: aggregate(events) });
      })
      .catch((err) => {
        if (!active) return;
        console.warn("[analytics] load failed:", err?.code || err);
        setState({ loading: false, error: err, events: [], stats: null });
      });
    return () => {
      active = false;
    };
  }, [range.startMs, range.endMs, range.max, nonce]);

  return { ...state, reload };
}
