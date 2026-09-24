import { AppState } from 'react-native';
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import authReducer from './authSlice';
import { api } from '../services/api';
import { isOnline, subscribeOnline } from '../services/connection';

export const store = configureStore({
  reducer: { auth: authReducer, [api.reducerPath]: api.reducer },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

// RTK Query's default focus/online listeners use browser events. On Android the
// app "focuses" when it returns to the foreground, and comes back online when
// the server is reachable again — refetch stale screens at both moments.
setupListeners(store.dispatch, (dispatch, { onFocus, onFocusLost, onOnline, onOffline }) => {
  let last = AppState.currentState;
  const appSub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && last !== 'active') dispatch(onFocus());
    else if (next !== 'active' && last === 'active') dispatch(onFocusLost());
    last = next;
  });
  const unsubOnline = subscribeOnline(() => dispatch(isOnline() ? onOnline() : onOffline()));
  return () => {
    appSub.remove();
    unsubOnline();
  };
});
