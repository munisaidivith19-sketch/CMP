import { useState } from 'react';
import { BookOpen, CheckCircle2, XCircle } from 'lucide-react';
import { useGetStudyMaterialStatusQuery } from '../../services/api';
import { EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { DEPARTMENTS, STUDY_MATERIAL_CATEGORY_LABELS, YEAR_LABELS, isFirstYearHod, semestersOfYear } from '../../utils/constants';
import { displayName, fmtDateTime, titleCase } from '../../utils/format';

/**
 * Upload status of one class: every subject of the chosen department +
 * semester, who teaches it, what was uploaded and when — or "Not uploaded".
 * HOD: years/semesters of their own department (the server pins it);
 * Science & Humanities HOD: 1st year of a chosen department;
 * Principal: any department, year and semester.
 */
export default function MaterialStatusModal({ open, onClose, me }) {
  const fyHod = isFirstYearHod(me);
  const pickDepartment = me.role === 'principal' || fyHod;
  const years = me.role === 'principal' ? [1, 2, 3, 4] : fyHod ? [1] : [2, 3, 4];
  const [department, setDepartment] = useState(pickDepartment ? '' : me.department || '');
  const [year, setYear] = useState(years.length === 1 ? String(years[0]) : '');
  const [semester, setSemester] = useState('');

  const ready = Boolean(semester && year && (department || !pickDepartment));
  const { data, isFetching, error, refetch } = useGetStudyMaterialStatusQuery(
    { semester, year, ...(pickDepartment ? { department } : {}) },
    { skip: !open || !ready }
  );

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Study material status" subtitle="Which subjects have material uploaded, by whom and when.">
      <div className="space-y-4">
        <div className={cn('grid gap-3', pickDepartment ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {pickDepartment && (
            <select aria-label="Department" className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Select department</option>
              {DEPARTMENTS.filter((d) => !(fyHod && d === me.department)).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          <select
            aria-label="Year"
            className="input"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setSemester('');
            }}
          >
            <option value="">Select year</option>
            {years.map((y) => (
              <option key={y} value={y}>{YEAR_LABELS[y]}</option>
            ))}
          </select>
          <select aria-label="Semester" className="input" value={semester} disabled={!year} onChange={(e) => setSemester(e.target.value)}>
            <option value="">Select semester</option>
            {year &&
              semestersOfYear(year).map((s) => (
                <option key={s} value={s}>Semester {s}</option>
              ))}
          </select>
        </div>

        {!ready ? (
          <EmptyState icon={BookOpen} title="Pick a class" text={pickDepartment ? 'Choose a department, year and semester.' : 'Choose a year and semester.'} />
        ) : isFetching && !data ? (
          <Skeleton className="h-40" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data?.subjects.length ? (
          <EmptyState icon={BookOpen} title="No subjects" text={`No subjects are set up for ${data?.department || 'this department'}, semester ${semester}.`} />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-xl bg-primary-500/10 px-2.5 py-1 text-primary-700 dark:text-primary-200">{data.department} · Sem {data.semester}</span>
              <span className="rounded-xl bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">{data.summary.uploaded} uploaded</span>
              <span className="rounded-xl bg-rose-500/10 px-2.5 py-1 text-rose-700 dark:text-rose-300">{data.summary.notUploaded} not uploaded</span>
            </div>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-2">Subject / Code</th>
                    <th className="px-2 py-2">Faculty</th>
                    <th className="px-2 py-2">Material uploaded</th>
                    <th className="px-2 py-2">Uploaded on</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/60 align-top dark:divide-white/5">
                  {data.subjects.map((row) => (
                    <tr key={row.subject._id}>
                      <td className="px-2 py-2.5">
                        <p className="font-semibold">{row.subject.name}</p>
                        <p className="font-mono text-xs muted">{row.subject.code}</p>
                      </td>
                      <td className="px-2 py-2.5 text-xs">
                        {row.faculty.length
                          ? row.faculty.map((f) => (
                              <p key={f._id}>
                                {displayName(f)}
                                {f.sections?.length ? <span className="muted"> · Sec {f.sections.join(', ')}</span> : null}
                              </p>
                            ))
                          : <span className="muted">Not assigned</span>}
                      </td>
                      <td className="px-2 py-2.5 text-xs">
                        {row.materials.length ? (
                          row.materials.map((m) => (
                            <p key={m._id}>
                              <span className="font-semibold">{STUDY_MATERIAL_CATEGORY_LABELS[m.category] || titleCase(m.category)}</span>
                              <span className="muted"> · {m.title}{m.section ? ` · Sec ${m.section}` : ''}{m.uploadedBy ? ` · by ${displayName(m.uploadedBy)}` : ''}</span>
                            </p>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-xs whitespace-nowrap">
                        {row.materials.length ? row.materials.map((m) => <p key={m._id}>{fmtDateTime(m.uploadedAt)}</p>) : <span className="muted">—</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        {row.status === 'uploaded' ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> Uploaded
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                            <XCircle className="h-3 w-3" /> Not uploaded
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
