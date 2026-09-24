import { useSelector } from 'react-redux';
import { selectUser } from '../../features/authSlice';
import StudentAttendance from './StudentAttendance';
import StaffAttendance from './StaffAttendance';

/** Students see their own record; faculty and admins get the marking console. */
export default function Attendance() {
  const me = useSelector(selectUser);
  return ['admin', 'faculty'].includes(me.role) ? <StaffAttendance /> : <StudentAttendance />;
}
