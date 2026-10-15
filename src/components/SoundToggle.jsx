import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  getServerSoundSnapshot,
  getSoundSnapshot,
  playUiClick,
  subscribeSound,
  toggleSoundEnabled,
} from "../lib/uiSounds.js";

/**
 * Header control that turns the UI click sounds on or off.
 *
 * The preference is global and shared with the delegated click listener, so
 * this is the only place the setting lives.
 */
export default function SoundToggle({ className = "" }) {
  const enabled = useSyncExternalStore(
    subscribeSound,
    getSoundSnapshot,
    getServerSoundSnapshot
  );

  const handleClick = () => {
    const next = !enabled;
    toggleSoundEnabled();
    // Give audible confirmation when switching sound back on: the delegated
    // listener could not play one because sound was still off.
    if (next) playUiClick();
  };

  const label = enabled ? "Turn off click sounds" : "Turn on click sounds";

  return (
    <button
      type="button"
      className={`sound-toggle${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
    >
      {enabled ? (
        <Volume2 size={18} aria-hidden="true" />
      ) : (
        <VolumeX size={18} aria-hidden="true" />
      )}
    </button>
  );
}
