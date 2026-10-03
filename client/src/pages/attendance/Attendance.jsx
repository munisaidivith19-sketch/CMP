import { useSelector } from 'react-redux';
import { selectUser } from '../../features/authSlice';
import StudentAttendance from './StudentAttendance';
import StaffAttendance from './StaffAttendance';
import { ATTENDANCE_VIEW } from '../../utils/constants';

/**
 * Students see their own record; faculty and HOD get the marking console, and
 * the college-wide authorities (principal, chairman, dean, AO) the same
 * console in read-only form.
 */
export default function Attendance() {
  const me = useSelector(selectUser);
  return ATTENDANCE_VIEW.includes(me.role) ? <StaffAttendance /> : <StudentAttendance />;
}
