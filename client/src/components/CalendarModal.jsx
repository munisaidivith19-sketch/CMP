import { useState } from 'react';
import { useSelector } from 'react-redux';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { useGetEventsQuery, useGetHolidaysQuery } from '../services/api';
import { selectUser } from '../features/authSlice';
import { TIMETABLE_ROLES } from '../utils/constants';
import { Button, Spinner } from './ui/primitives';
import { Modal } from './ui/Modal';
import MiniCalendar from './MiniCalendar';

/** Full campus calendar, opened from the calendar icon in the top bar. Loads one visible month at a time. */
export default function CalendarModal({ open, onClose }) {
  const me = useSelector(selectUser);
  const [month, setMonth] = useState(new Date());
  const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const { data, isFetching } = useGetEventsQuery(
    { when: 'all', from: from.toISOString(), to: to.toISOString(), limit: 50 },
    { skip: !open }
  );
  // Holidays that apply to this viewer — the server decides which. Roles with
  // no academic calendar (warden, security, alumni) are not asked.
  const academic = TIMETABLE_ROLES.includes(me?.role) && me?.role !== 'alumni';
  const { data: hol } = useGetHolidaysQuery(
    { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') },
    { skip: !open || !academic }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          Campus calendar {isFetching && <Spinner className="h-4 w-4" />}
        </span>
      }
      subtitle="Events and holidays — pick a day to see what's on."
      footer={
        <Button to="/events" variant="soft" icon={ArrowRight} onClick={onClose}>
          All events
        </Button>
      }
    >
      <MiniCalendar large events={data?.items || []} holidays={hol?.holidays || []} month={month} onMonthChange={setMonth} />
    </Modal>
  );
}
