import { useState } from 'react';
import toast from 'react-hot-toast';
import { Download, ShieldCheck } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/primitives';
import { Select } from './ui/form';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, YEAR_LABELS } from '../utils/constants';
import { downloadProfilesPdf } from '../services/reports';
import { errMsg } from '../utils/format';

const GROUPS = [
  { value: 'student', label: 'Students' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'hod', label: 'HODs' },
  { value: 'staff', label: 'Leadership & administration' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'all', label: 'All users' },
];

/**
 * Choose what goes into the profiles directory PDF: a role group, then its
 * department and — for students — year and section. The server applies the
 * same choice and records every download in the security log.
 */
export default function DirectoryExportModal({ open, onClose }) {
  const [v, setV] = useState({ role: '', department: '', year: '', section: '' });
  const [busy, setBusy] = useState(false);
  const isStudent = v.role === 'student';
  const hasDept = v.role && v.role !== 'staff';

  const pickRole = (role) => setV({ role, department: '', year: '', section: '' });
  const download = async () => {
    setBusy(true);
    try {
      const params = {
        role: v.role,
        department: hasDept ? v.department : '',
        year: isStudent ? v.year : '',
        section: isStudent ? v.section : '',
      };
      const filename = await downloadProfilesPdf(params);
      toast.success(`Downloaded ${filename}`);
      onClose();
    } catch (e) {
      toast.error(e?.message || errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export directory (PDF)"
      subtitle="Choose who to include"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Download} loading={busy} disabled={!v.role} onClick={download}>Download PDF</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select label="Role" keepCase placeholder="Choose a role" options={GROUPS} value={v.role} onChange={(e) => pickRole(e.target.value)} />
        {hasDept && (
          <Select
            label="Department"
            keepCase
            placeholder="All departments"
            options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
            value={v.department}
            onChange={(e) => setV({ ...v, department: e.target.value })}
          />
        )}
        {isStudent && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Year"
              keepCase
              placeholder="All years"
              options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))}
              value={v.year}
              onChange={(e) => setV({ ...v, year: e.target.value })}
            />
            <Select
              label="Section"
              keepCase
              placeholder="All sections"
              options={SECTIONS.map((s) => ({ value: s, label: `Section ${s}` }))}
              value={v.section}
              onChange={(e) => setV({ ...v, section: e.target.value })}
            />
          </div>
        )}
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          This file contains personal details. Your download — who, when, from which device and what was selected — is recorded in the security log.
        </p>
      </div>
    </Modal>
  );
}
