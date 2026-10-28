export type Theme = "light" | "dark";

const STORAGE_KEY = "tenderflow.theme";

/** Preferenza salvata dal singolo utente; il default è chiaro. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage non disponibile (es. navigazione privata): il tema vale solo per la sessione.
  }
}
