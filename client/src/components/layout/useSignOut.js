import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { api, useLogoutMutation } from '../../services/api';
import { broadcastSession } from '../../services/sessionSync';
import { loggedOut } from '../../features/authSlice';
import { disconnectSocket } from '../../services/socket';

/** Manual sign-out: server logout, socket closed, state cleared, every tab signed out. */
export default function useSignOut() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [logout] = useLogoutMutation();

  return async () => {
    try {
      await logout().unwrap();
    } catch {
      /* ignore network errors on logout */
    }
    disconnectSocket();
    // Sign out every other open tab too (an event only — no token is shared).
    broadcastSession({ type: 'logout', reason: 'manual' });
    dispatch(loggedOut());
    dispatch(api.util.resetApiState());
    navigate('/login');
  };
}
