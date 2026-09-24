import { createSlice } from '@reduxjs/toolkit';

// Same shape as the web app's auth slice. The refresh token is NOT kept in
// Redux — it lives only in the device's encrypted SecureStore.
const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, accessToken: null, ready: false },
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
