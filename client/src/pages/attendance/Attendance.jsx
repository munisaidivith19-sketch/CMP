import { useSelector } from 'react-redux';
import { selectUser } from '../../features/authSlice';
import StudentAttendance from './StudentAttendance';
import StaffAttendance from './StaffAttendance';
import { STAFF_VIEW } from '../../utils/constants';

/** Students see their own record; staff get the marking console (principal: read-only views). */
export default function Attendance() {
  const me = useSelector(selectUser);
  return STAFF_VIEW.includes(me.role) ? <StaffAttendance /> : <StudentAttendance />;
}
