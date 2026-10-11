import { useEffect, useState } from "react";
import { getConsent, isConsentRequired, setConsent, trackPageView } from "../../lib/analytics.js";

/**
 * Minimal, accessible consent banner. Only rendered when
 * VITE_REQUIRE_CONSENT=true. Until the visitor decides, no analytics are
 * recorded (GA4 also defaults to denied - see index.html). Accepting records
 * the current page view immediately so the decision is reflected at once.
 */
export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isConsentRequired()) return;
    if (getConsent() !== null) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  function decide(value) {
    setConsent(value);
    setVisible(false);
    if (value === "granted") {
      trackPageView({ path: window.location.pathname, title: document.title });
    }
  }

  return (
    <div className="consent-banner" role="dialog" aria-label="Analytics consent">
      <p className="consent-text">
        We use privacy-friendly, first-party analytics to understand which notes
        are useful. No personal data or IP addresses are stored. See our{" "}
        <a href="/privacy-policy">Privacy Policy</a>.
      </p>
      <div className="consent-actions">
        <button type="button" className="btn btn-ghost" onClick={() => decide("denied")}>
          Decline
        </button>
        <button type="button" className="btn btn-primary" onClick={() => decide("granted")}>
          Accept analytics
        </button>
      </div>
    </div>
  );
}
