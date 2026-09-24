import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  user: null,
  accessToken: null,
  ready: false, // true once the initial session check has finished
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, { payload }) {
      state.user = payload.user;
      state.accessToken = payload.accessToken;
    },
    setUser(state, { payload }) {
      state.user = payload;
    },
    loggedOut(state) {
      state.user = null;
      state.accessToken = null;
    },
    sessionChecked(state) {
      state.ready = true;
    },
  },
});

export const { setCredentials, setUser, loggedOut, sessionChecked } = authSlice.actions;
export default authSlice.reducer;

export const selectUser = (s) => s.auth.user;
export const selectRole = (s) => s.auth.user?.role;
export const selectIsModerator = (s) => ['admin', 'faculty'].includes(s.auth.user?.role);
