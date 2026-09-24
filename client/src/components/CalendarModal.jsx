import { useState } from 'react';
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { useGetEventsQuery } from '../services/api';
import { Button, Spinner } from './ui/primitives';
import { Modal } from './ui/Modal';
import MiniCalendar from './MiniCalendar';

/** Full campus calendar, opened from the calendar icon in the top bar. Loads one visible month at a time. */
export default function CalendarModal({ open, onClose }) {
  const [month, setMonth] = useState(new Date());
  const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const { data, isFetching } = useGetEventsQuery(
    { when: 'all', from: from.toISOString(), to: to.toISOString(), limit: 50 },
    { skip: !open }
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
      subtitle="Events across campus — pick a day to see what's on."
      footer={
        <Button to="/events" variant="soft" icon={ArrowRight} onClick={onClose}>
          All events
        </Button>
      }
    >
      <MiniCalendar large events={data?.items || []} month={month} onMonthChange={setMonth} />
    </Modal>
  );
}
