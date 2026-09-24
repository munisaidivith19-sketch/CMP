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
  initialState: { theme: readTheme(), sidebarOpen: false },
  reducers: {
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

export const { toggleTheme, setSidebar } = uiSlice.actions;
export default uiSlice.reducer;
