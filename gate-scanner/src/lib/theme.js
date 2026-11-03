// Light / Dark / System. "system" follows the Windows setting; the choice is a
// per-PC convenience kept in localStorage (the app works without it).

export const THEME_KEY = 'gate.theme';
export const THEME_CHOICES = ['system', 'light', 'dark'];

export function readTheme(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(THEME_KEY);
    return THEME_CHOICES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(choice, storage = globalThis.localStorage) {
  try {
    if (choice === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    /* storage unavailable: the choice lasts until the app closes */
  }
}

/** Is the dark palette shown for this choice? */
export const isDark = (choice, systemDark) => (choice === 'system' ? Boolean(systemDark) : choice === 'dark');

/** Apply a choice to the page; returns whether dark is now showing. */
export function applyTheme(choice, { root = document.documentElement, media = window.matchMedia('(prefers-color-scheme: dark)') } = {}) {
  const dark = isDark(choice, media.matches);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark;
}
