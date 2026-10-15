import { useEffect } from "react";
import { installClickSounds } from "../lib/uiSounds.js";

/**
 * Mounts the single delegated click-sound listener for the whole app.
 *
 * Renders nothing. The effect returns the installer's cleanup, so the listener
 * is removed on unmount and never duplicated across re-renders.
 */
export default function ClickSounds() {
  useEffect(() => installClickSounds(), []);
  return null;
}
