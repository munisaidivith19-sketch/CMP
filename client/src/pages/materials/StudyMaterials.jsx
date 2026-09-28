import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { BookOpen, Download, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDeleteStudyMaterialMutation, useGetMyTeachingAssignmentsQuery, useGetStudyMaterialsQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { DEPARTMENTS, STUDY_MATERIAL_CATEGORY_LABELS } from '../../utils/constants';
import { errMsg, fmtClassDay, titleCase } from '../../utils/format';
import UploadMaterialModal from './UploadMaterialModal';
import StudyAssistant from '../../components/StudyAssistant';

const STUDENT_ROLES = ['student', 'club_admin'];
const WRITE_ROLES = ['faculty', 'hod', 'admin'];

const fmtSize = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

function MaterialCard({ material, canManage, onEdit, onDelete }) {
  return (
    <Card hover className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-primary-400" />
        <h3 className="text-sm font-extrabold">{material.title}</h3>
        <Badge color="primary">{STUDY_MATERIAL_CATEGORY_LABELS[material.category] || titleCase(material.category)}</Badge>
      </div>
      <p className="text-xs muted">
        {material.subjectName} — {material.subjectCode} · {material.department}
        {material.section ? ` · Sec ${material.section}` : ''} · Sem {material.semester}
      </p>
      {material.description && <p className="text-sm">{material.description}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar user={material.uploadedBy} size="xs" />
          <span className="truncate text-xs muted">
            {material.uploadedBy?.name} · {fmtClassDay(material.createdAt, 'dd MMM yyyy')}
          </span>
        </div>
        <a href={material.file?.url} target="_blank" rel="noreferrer" className="btn btn-outline ml-auto !py-1.5 !text-xs">
          <Download className="h-3.5 w-3.5" /> {material.file?.name || 'Download'}
          {material.file?.size ? ` · ${fmtSize(material.file.size)}` : ''}
        </a>
        {canManage && (
          <div className="flex gap-1">
            <button type="button" className="rounded-lg p-1.5 hover:bg-white" aria-label="Edit material" title="Edit" onClick={() => onEdit(material)}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded-lg p-1.5 hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete material" title="Delete" onClick={() => onDelete(material)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function StudyMaterials() {
  const me = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(me.role);
  const canWrite = WRITE_ROLES.includes(me.role);
  const [filters, setFilters] = useState({ department: isStudent ? me.department : '', category: '', q: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [del, setDel] = useState(null);

  const { data, isLoading, error, refetch } = useGetStudyMaterialsQuery({
    page,
    limit: 15,
    department: !isStudent && filters.department ? filters.department : undefined,
    category: filters.category || undefined,
    q: filters.q || undefined,
  });
  const { data: assignments = [] } = useGetMyTeachingAssignmentsQuery(undefined, { skip: me.role !== 'faculty' });
  const [remove, { isLoading: removing }] = useDeleteStudyMaterialMutation();

  // The server is the real authority — this only decides whether to show the
  // edit/delete icons at all, so a faculty member isn't shown controls for a
  // class they don't currently teach.
  const assignmentKeys = useMemo(
    () => new Set(assignments.map((a) => `${a.department}|${a.section}|${a.semester}|${a.subject._id}`)),
    [assignments]
  );
  const canManage = (m) => {
    if (me.role === 'admin') return true;
    if (me.role === 'hod') return m.department === me.department;
    if (me.role === 'faculty') return assignmentKeys.has(`${m.department}|${m.section}|${m.semester}|${m.subject}`);
    return false;
  };

  const set = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BookOpen}
        title="Study Materials"
        subtitle={isStudent ? 'Notes, question banks and resources for your class.' : 'Class notes, question banks and other resources.'}
        actions={
          canWrite && (
            <Button icon={Plus} onClick={() => setEditing(null)}>
              Upload material
            </Button>
          )
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        {/* JNN Study Assistant: above the list on small screens, a sticky side card on wide ones */}
        <StudyAssistant className="xl:sticky xl:top-4 xl:order-2" />

        <div className="min-w-0 space-y-5 xl:order-1">
          <Card className="grid gap-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search by title…" className="input pl-11" />
            </div>
            {!isStudent && (
              <select className="input" value={filters.department} onChange={(e) => set({ department: e.target.value })}>
                <option value="">All departments</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            <select className="input" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All categories</option>
              {Object.entries(STUDY_MATERIAL_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Card>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : !data.items.length ? (
            <Card>
              <EmptyState
                icon={BookOpen}
                title="No study materials yet"
                text={canWrite ? 'Upload notes, question banks or other resources for your class.' : 'Materials for your class will appear here once uploaded.'}
                action={
                  canWrite && (
                    <Button icon={Plus} onClick={() => setEditing(null)}>
                      Upload material
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {data.items.map((m) => (
                  <MaterialCard key={m._id} material={m} canManage={canManage(m)} onEdit={setEditing} onDelete={setDel} />
                ))}
              </div>
              <Pagination page={data.page} pages={data.pages} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      {canWrite && <UploadMaterialModal open={editing !== undefined} material={editing} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title="Remove this material?"
        text="Students and staff will no longer see it."
        confirmText="Remove"
        loading={removing}
        onConfirm={async () => {
          try {
            await remove(del._id).unwrap();
            toast.success('Material removed');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </div>
  );
}
