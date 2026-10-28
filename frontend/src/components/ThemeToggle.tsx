import type { Theme } from "../lib/theme";

const SUN = "M12 3v1M12 20v1M4.22 4.22l.7.7M19.08 19.08l.7.7M3 12h1M20 12h1M4.22 19.78l.7-.7M19.08 4.92l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z";
const MOON = "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z";

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg-2 transition hover:border-subtle"
      aria-label={next === "dark" ? "Passa alla modalità scura" : "Passa alla modalità chiara"}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={theme === "light" ? MOON : SUN} />
      </svg>
      {theme === "light" ? "Scura" : "Chiara"}
    </button>
  );
}
