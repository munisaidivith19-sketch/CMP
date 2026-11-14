// Applies the saved theme before the app renders (no flash of the wrong theme).
// A same-origin file, not an inline <script>: the production CSP
// (script-src 'self') blocks inline scripts, so inline it never ran.
(function () {
  try {
    var saved = localStorage.getItem('cc-theme');
    var isDark = saved !== 'light'; // dark by default until the user picks light
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
