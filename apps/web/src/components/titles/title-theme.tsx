import { useEffect } from "react";
import { applyAccent, getPersistedAccent } from "@/lib/appearance";

const THEME_PROPERTIES = [
  "--primary",
  "--ring",
  "--primary-foreground",
  "--status-watching",
] as const;

export function TitleTheme({ style }: { style: Record<string, string> }) {
  useEffect(() => {
    const root = document.documentElement;
    const entries = THEME_PROPERTIES.filter((key) => key in style);

    for (const key of entries) {
      root.style.setProperty(key, style[key]);
    }

    return () => {
      // 28.08, Sid — real bug: plain removeProperty here fell back to
      // globals.css's hardcoded default (amber) instead of her chosen
      // accent — her accent (appearance.ts's applyAccent) is ALSO an inline
      // style on this same element, and this cleanup was clobbering that
      // override rather than restoring it. Confirmed live: visiting any
      // title page then navigating away permanently reverted the whole app
      // to amber, until she re-picked her color by hand in Settings.
      // --status-watching isn't part of the persisted accent (no saved
      // value to restore) — removing it to fall back to the CSS default is
      // correct as-is.
      applyAccent(getPersistedAccent());
      root.style.removeProperty("--status-watching");
    };
  }, [style]);

  return null;
}
