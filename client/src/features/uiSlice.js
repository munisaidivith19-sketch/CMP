import { createSlice } from '@reduxjs/toolkit';

function readTheme() {
  try {
    const saved = localStorage.getItem('cc-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const uiSlice = createSlice({
  name: 'ui',
  // maintenance: the server's maintenance message while the platform is not in
  // normal mode (set from any 503 MAINTENANCE answer), else null.
  initialState: { theme: readTheme(), sidebarOpen: false, maintenance: null },
  reducers: {
    setMaintenance(state, { payload }) {
      state.maintenance = payload || null;
    },
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('cc-theme', state.theme);
      } catch {
        /* ignore */
      }
    },
    setSidebar(state, { payload }) {
      state.sidebarOpen = payload;
    },
  },
});

export const { toggleTheme, setSidebar, setMaintenance } = uiSlice.actions;
export default uiSlice.reducer;
