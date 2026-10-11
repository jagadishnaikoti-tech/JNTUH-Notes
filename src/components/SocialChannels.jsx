import { useEffect, useState } from "react";
import { fetchPublicChannels } from "../lib/channels.js";
import { socialIcon } from "../lib/social.js";

/**
 * Renders the administrator-configured social channels in the public UI.
 * Renders nothing at all when no channels are configured (or Firebase is not
 * set up), so it stays invisible until a channel is actually added.
 *
 * `variant` controls styling: "sidebar" (compact icon buttons) or "footer"
 * (icon + label list).
 */
export default function SocialChannels({ variant = "footer" }) {
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    let active = true;
    fetchPublicChannels().then((list) => {
      if (active) setChannels(list);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!channels.length) return null;

  if (variant === "sidebar") {
    return (
      <>
        <p className="sidebar-section-label">Follow</p>
        <div className="sb-social" aria-label="Social channels">
          {channels.map((ch) => {
            const { label, Icon } = socialIcon(ch.icon);
            return (
              <a
                key={ch.id}
                className="sb-social-link"
                href={ch.url}
                target="_blank"
                rel="noopener noreferrer"
                title={ch.name || label}
                aria-label={ch.name || label}
              >
                <Icon size={16} aria-hidden="true" />
              </a>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <nav className="footer-col" aria-label="Social channels">
      <h2 className="footer-heading">Follow us</h2>
      <ul className="footer-list">
        {channels.map((ch) => {
          const { label, Icon } = socialIcon(ch.icon);
          return (
            <li key={ch.id}>
              <a href={ch.url} target="_blank" rel="noopener noreferrer">
                <Icon size={15} aria-hidden="true" />
                {ch.name || label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
