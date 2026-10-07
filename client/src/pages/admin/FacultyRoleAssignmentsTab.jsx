import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeftRight,
  Building2,
  CheckCircle2,
  GraduationCap,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  AlertTriangle,
} from 'lucide-react';
import {
  useGetRoleAssignmentsOverviewQuery,
  useAssignClassInChargeMutation,
  useSwapClassInChargeMutation,
  useUnassignClassInChargeMutation,
  useSetDepartmentHodMutation,
  useDemoteDepartmentHodMutation,
} from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, PageLoader } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { ACADEMIC_YEARS, DEPARTMENTS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, displayName } from '../../utils/format';

/**
 * Visual Class In-Charge & Department HOD Role Management Tab.
 * Guarantees ZERO data loss during reassignments, mutual swaps, and demotions.
 */
export default function FacultyRoleAssignmentsTab() {
  const { data, isLoading, refetch } = useGetRoleAssignmentsOverviewQuery();
  const [assignClassInCharge, { isLoading: assigning }] = useAssignClassInChargeMutation();
  const [swapClassInCharge, { isLoading: swapping }] = useSwapClassInChargeMutation();
  const [unassignClassInCharge, { isLoading: unassigning }] = useUnassignClassInChargeMutation();
  const [setDepartmentHod, { isLoading: settingHod }] = useSetDepartmentHodMutation();
  const [demoteDepartmentHod, { isLoading: demotingHod }] = useDemoteDepartmentHodMutation();

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [q, setQ] = useState('');

  // Modals state
  const [assignModal, setAssignModal] = useState(null); // { classItem }
  const [swapModal, setSwapModal] = useState(null); // { sourceClass, sourceFaculty }
  const [unassignConfirm, setUnassignConfirm] = useState(null); // { classItem, faculty }
  const [hodModal, setHodModal] = useState(null); // { department, currentHod }
  const [demoteHodConfirm, setDemoteHodConfirm] = useState(null); // { department, hod }

  // State inside Swap modal
  const [targetClassKey, setTargetClassKey] = useState('');
  // State inside Assign modal
  const [selectedFacultyId, setSelectedFacultyId] = useState('');
  // State inside Set HOD modal
  const [selectedHodFacultyId, setSelectedHodFacultyId] = useState('');

  const classes = data?.classes || [];
  const hods = data?.hods || [];
  const facultyList = data?.facultyList || [];

  // Filtered classes
  const filteredClasses = useMemo(() => {
    return classes.filter((c) => {
      if (deptFilter && c.department !== deptFilter) return false;
      if (yearFilter && Number(c.year) !== Number(yearFilter)) return false;
      if (q) {
        const query = q.toLowerCase().trim();
        const classNameStr = `${c.department} Year ${c.year} Sec ${c.section} Sem ${c.semester}`.toLowerCase();
        const inChargeStr = c.inCharge
          ? `${c.inCharge.name} ${c.inCharge.email} ${c.inCharge.employeeId || ''}`.toLowerCase()
          : 'unassigned';
        if (!classNameStr.includes(query) && !inChargeStr.includes(query)) return false;
      }
      return true;
    });
  }, [classes, deptFilter, yearFilter, q]);

  // Handle Assign In-Charge
  const handleAssign = async () => {
    if (!assignModal || !selectedFacultyId) return;
    try {
      const res = await assignClassInCharge({
        facultyId: selectedFacultyId,
        department: assignModal.department,
        year: assignModal.year,
        section: assignModal.section,
        semester: assignModal.semester,
      }).unwrap();
      toast.success(res.message || 'Class In-Charge assigned successfully');
      setAssignModal(null);
      setSelectedFacultyId('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Handle Mutual Swap
  const handleSwap = async () => {
    if (!swapModal || !targetClassKey) return;
    const targetClass = classes.find(
      (c) => `${c.department}|${c.year}|${c.section}|${c.semester}` === targetClassKey
    );
    if (!targetClass || !targetClass.inCharge) {
      toast.error('Selected target class does not have an assigned faculty to swap with');
      return;
    }

    try {
      const res = await swapClassInCharge({
        faculty1Id: swapModal.sourceFaculty._id,
        faculty2Id: targetClass.inCharge._id,
      }).unwrap();
      toast.success(res.message || 'Classes swapped successfully');
      setSwapModal(null);
      setTargetClassKey('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Handle Unassign / Relieve
  const handleUnassign = async () => {
    if (!unassignConfirm) return;
    try {
      const res = await unassignClassInCharge({
        facultyId: unassignConfirm.faculty._id,
      }).unwrap();
      toast.success(res.message || 'Class In-Charge relieved successfully');
      setUnassignConfirm(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Handle Set HOD
  const handleSetHod = async () => {
    if (!hodModal || !selectedHodFacultyId) return;
    try {
      const res = await setDepartmentHod({
        department: hodModal.department,
        facultyId: selectedHodFacultyId,
      }).unwrap();
      toast.success(res.message || 'HOD assigned successfully');
      setHodModal(null);
      setSelectedHodFacultyId('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Handle Demote HOD
  const handleDemoteHod = async () => {
    if (!demoteHodConfirm) return;
    try {
      const res = await demoteDepartmentHod({
        hodId: demoteHodConfirm.hod._id,
      }).unwrap();
      toast.success(res.message || 'HOD demoted to faculty successfully');
      setDemoteHodConfirm(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-8">
      {/* ── Section 1: Department HOD Role Management ── */}
      <div className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-ink dark:text-primary-50 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary-500" />
              Department Heads (HODs)
            </h2>
            <p className="text-xs text-ink-soft dark:text-ink-muted">
              Appoint department heads or demote to regular faculty. Demoting switches their view to the Staff Dashboard immediately with zero data loss.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hods.map(({ department, hod }) => (
            <Card key={department} className="flex flex-col justify-between border border-primary-500/10 p-4 transition-shadow hover:shadow-md">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-sm text-ink dark:text-primary-100">{department}</span>
                  {hod ? (
                    <Badge variant="success" className="text-[10px] font-bold">
                      <Shield className="mr-1 h-3 w-3" /> HOD Active
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px] font-bold">
                      Vacant
                    </Badge>
                  )}
                </div>

                {hod ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-primary-500/5 p-3 dark:bg-white/[0.03]">
                    <Avatar user={hod} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-ink dark:text-primary-50">{displayName(hod)}</p>
                      <p className="truncate text-[11px] text-ink-muted">{hod.email}</p>
                      {hod.employeeId && (
                        <p className="text-[10px] font-semibold text-primary-600 dark:text-primary-400">ID: {hod.employeeId}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-ink/10 p-3 text-center dark:border-white/10">
                    <p className="text-xs text-ink-muted">No HOD appointed for this department yet.</p>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 pt-2 border-t border-ink/5 dark:border-white/5">
                <Button
                  size="sm"
                  variant={hod ? 'secondary' : 'primary'}
                  className="flex-1 text-xs"
                  onClick={() => {
                    setHodModal({ department, currentHod: hod });
                    setSelectedHodFacultyId('');
                  }}
                >
                  {hod ? 'Change HOD' : 'Assign HOD'}
                </Button>
                {hod && (
                  <Button
                    size="sm"
                    variant="soft"
                    className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 text-xs"
                    onClick={() => setDemoteHodConfirm({ department, hod })}
                  >
                    Demote
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Section 2: Class In-Charge Assignments & 1-Click Mutual Swap ── */}
      <div className="space-y-4 pt-4 border-t border-ink/5 dark:border-white/5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-ink dark:text-primary-50 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary-500" />
              Class In-Charge Assignments & Handover
            </h2>
            <p className="text-xs text-ink-soft dark:text-ink-muted">
              Manage class coordinators. Swap responsibilities between staff members in 1-click or relieve them to regular faculty with <strong>Zero Data Loss</strong>.
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <Card className="grid gap-3 sm:grid-cols-[1fr_160px_160px] p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search class, section, or faculty name…"
              className="input pl-9 text-xs"
            />
          </div>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input text-xs">
            <option value="">All Departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="input text-xs">
            <option value="">All Years</option>
            {ACADEMIC_YEARS.map((y) => (
              <option key={y} value={y}>
                {YEAR_LABELS[y]}
              </option>
            ))}
          </select>
        </Card>

        {/* Classes Table */}
        {!filteredClasses.length ? (
          <Card>
            <EmptyState icon={GraduationCap} title="No classes found matching filters" />
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead>
                  <tr className="border-b border-ink/5 bg-primary-500/[0.02] text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-white/5 dark:bg-white/[0.02]">
                    <th className="px-5 py-3 font-bold">Class Details</th>
                    <th className="px-4 py-3 font-bold">Enrolled Students</th>
                    <th className="px-4 py-3 font-bold">Class In-Charge</th>
                    <th className="px-5 py-3 text-right font-bold">Role Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5 dark:divide-white/5">
                  {filteredClasses.map((c) => {
                    const classId = `${c.department}|${c.year}|${c.section}|${c.semester}`;
                    return (
                      <tr key={classId} className="hover:bg-primary-500/[0.02] transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-extrabold text-ink dark:text-primary-50 text-xs">
                            {c.department}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-muted">
                            <span className="font-semibold text-primary-600 dark:text-primary-400">
                              {YEAR_LABELS[c.year] || `Year ${c.year}`}
                            </span>
                            <span>•</span>
                            <span className="font-semibold">Section {c.section}</span>
                            <span>•</span>
                            <span>Semester {c.semester}</span>
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                            <Users className="h-3 w-3" />
                            {c.studentCount} {c.studentCount === 1 ? 'student' : 'students'}
                          </span>
                        </td>

                        <td className="px-4 py-3.5">
                          {c.inCharge ? (
                            <div className="flex items-center gap-2.5">
                              <Avatar user={c.inCharge} size="xs" />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-ink dark:text-primary-50">
                                  {displayName(c.inCharge)}
                                </p>
                                <p className="truncate text-[10px] text-ink-muted">
                                  {c.inCharge.email} {c.inCharge.employeeId ? `· ID: ${c.inCharge.employeeId}` : ''}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Unassigned
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {c.inCharge ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={ArrowLeftRight}
                                  className="text-xs py-1 px-2.5"
                                  onClick={() => {
                                    setSwapModal({ sourceClass: c, sourceFaculty: c.inCharge });
                                    setTargetClassKey('');
                                  }}
                                  title="Swap this class with another faculty member"
                                >
                                  Swap
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs py-1 px-2.5"
                                  onClick={() => {
                                    setAssignModal(c);
                                    setSelectedFacultyId(c.inCharge._id);
                                  }}
                                  title="Reassign to another faculty member"
                                >
                                  Reassign
                                </Button>
                                <Button
                                  size="sm"
                                  variant="soft"
                                  className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 text-xs py-1 px-2"
                                  onClick={() => setUnassignConfirm({ classItem: c, faculty: c.inCharge })}
                                  title="Relieve from Class In-Charge back to regular faculty"
                                >
                                  Relieve
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                icon={UserPlus}
                                className="text-xs py-1 px-3"
                                onClick={() => {
                                  setAssignModal(c);
                                  setSelectedFacultyId('');
                                }}
                              >
                                Assign In-Charge
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* ── Modal 1: Mutual Swap Modal ── */}
      {swapModal && (
        <Modal
          open={Boolean(swapModal)}
          onClose={() => setSwapModal(null)}
          title="Mutual Class In-Charge Swap"
          size="lg"
        >
          <div className="space-y-5">
            <div className="rounded-2xl bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200 border border-amber-500/20">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                Zero Data Loss Guarantee
              </p>
              <p className="mt-1">
                Student rosters, attendance sessions, attendance records, and OD requests belong permanently to the class. Swapping immediately shifts the administrative dashboard view between the two staff members without losing a single piece of data.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Left Side: Source Class */}
              <div className="rounded-2xl border border-primary-500/20 bg-primary-50/50 p-4 dark:bg-primary-500/5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                  Current Class & Faculty
                </span>
                <p className="mt-1 text-sm font-extrabold text-ink dark:text-primary-50">
                  {swapModal.sourceClass.department} • Year {swapModal.sourceClass.year} Sec {swapModal.sourceClass.section}
                </p>
                <p className="text-xs text-ink-muted">Semester {swapModal.sourceClass.semester} ({swapModal.sourceClass.studentCount} students)</p>

                <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-2.5 shadow-xs dark:bg-white/5">
                  <Avatar user={swapModal.sourceFaculty} size="xs" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-ink dark:text-primary-50">{displayName(swapModal.sourceFaculty)}</p>
                    <p className="truncate text-[10px] text-ink-muted">{swapModal.sourceFaculty.email}</p>
                  </div>
                </div>
              </div>

              {/* Right Side: Select Target Class */}
              <div className="rounded-2xl border border-dashed border-ink/20 p-4 dark:border-white/20">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                  Swap With Target Class
                </span>

                <select
                  value={targetClassKey}
                  onChange={(e) => setTargetClassKey(e.target.value)}
                  className="input mt-2 text-xs w-full"
                >
                  <option value="">Select a class to swap with…</option>
                  {classes
                    .filter(
                      (c) =>
                        c.inCharge &&
                        String(c.inCharge._id) !== String(swapModal.sourceFaculty._id)
                    )
                    .map((c) => {
                      const k = `${c.department}|${c.year}|${c.section}|${c.semester}`;
                      return (
                        <option key={k} value={k}>
                          {c.department} Yr {c.year} Sec {c.section} (Sem {c.semester}) — {displayName(c.inCharge)} ({c.studentCount} students)
                        </option>
                      );
                    })}
                </select>

                {targetClassKey && (
                  <div className="mt-3 rounded-xl bg-emerald-500/10 p-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <p className="font-bold">After swap:</p>
                    <p className="mt-0.5 text-[11px]">
                      • {displayName(swapModal.sourceFaculty)} will manage the selected class.
                    </p>
                    <p className="text-[11px]">
                      • Target faculty will take over {swapModal.sourceClass.department} Yr {swapModal.sourceClass.year} Sec {swapModal.sourceClass.section}.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-ink/5 dark:border-white/5">
              <Button variant="outline" onClick={() => setSwapModal(null)} disabled={swapping}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={ArrowLeftRight}
                loading={swapping}
                disabled={!targetClassKey}
                onClick={handleSwap}
              >
                Confirm Mutual Swap
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal 2: Assign / Reassign Modal ── */}
      {assignModal && (
        <Modal
          open={Boolean(assignModal)}
          onClose={() => setAssignModal(null)}
          title={`Assign Class In-Charge: ${assignModal.department} Year ${assignModal.year} Section ${assignModal.section}`}
        >
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">
              Select an active faculty member to appoint as the Class In-Charge for this class (Semester {assignModal.semester}, {assignModal.studentCount} students).
            </p>

            {assignModal.inCharge && (
              <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <span className="font-bold">Current In-Charge: </span>
                {displayName(assignModal.inCharge)} ({assignModal.inCharge.email}). Reassigning will safely relieve this faculty member back to regular department faculty with zero data loss.
              </div>
            )}

            <div>
              <label className="label text-xs">Select Faculty</label>
              <select
                value={selectedFacultyId}
                onChange={(e) => setSelectedFacultyId(e.target.value)}
                className="input text-xs w-full mt-1"
              >
                <option value="">Choose a faculty member…</option>
                {facultyList.map((f) => (
                  <option key={f._id} value={f._id}>
                    {displayName(f)} ({f.email}) — Dept: {f.department || 'General'}
                    {f.inCharge ? ` [Currently In-Charge: ${f.inCharge.department} Yr ${f.inCharge.year}-${f.inCharge.section}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-ink/5 dark:border-white/5">
              <Button variant="outline" onClick={() => setAssignModal(null)} disabled={assigning}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={UserCheck}
                loading={assigning}
                disabled={!selectedFacultyId}
                onClick={handleAssign}
              >
                Save Assignment
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal 3: Set Department HOD Modal ── */}
      {hodModal && (
        <Modal
          open={Boolean(hodModal)}
          onClose={() => setHodModal(null)}
          title={`Assign HOD for ${hodModal.department}`}
        >
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">
              Choose a faculty member to promote to Department Head (HOD) of {hodModal.department}.
            </p>

            <div className="rounded-xl bg-primary-500/10 p-3 text-xs text-primary-800 dark:text-primary-200">
              <p className="font-bold">Automatic Adjustments:</p>
              <p className="mt-0.5">• If the candidate was previously a Class In-Charge, their in-charge duties will be automatically cleared so they focus on HOD duties.</p>
              {hodModal.currentHod && (
                <p className="mt-0.5">• The previous HOD ({displayName(hodModal.currentHod)}) will be safely demoted to regular Faculty.</p>
              )}
            </div>

            <div>
              <label className="label text-xs">Select Faculty Candidate</label>
              <select
                value={selectedHodFacultyId}
                onChange={(e) => setSelectedHodFacultyId(e.target.value)}
                className="input text-xs w-full mt-1"
              >
                <option value="">Select candidate…</option>
                {facultyList.map((f) => (
                  <option key={f._id} value={f._id}>
                    {displayName(f)} ({f.email}) — Dept: {f.department || 'General'}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-ink/5 dark:border-white/5">
              <Button variant="outline" onClick={() => setHodModal(null)} disabled={settingHod}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={Shield}
                loading={settingHod}
                disabled={!selectedHodFacultyId}
                onClick={handleSetHod}
              >
                Appoint HOD
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Confirm Dialog: Relieve Class In-Charge ── */}
      <ConfirmDialog
        open={Boolean(unassignConfirm)}
        onClose={() => setUnassignConfirm(null)}
        title="Relieve Class In-Charge?"
        text={`Are you sure you want to relieve ${displayName(unassignConfirm?.faculty)} from Class In-Charge of ${unassignConfirm?.classItem?.department} Year ${unassignConfirm?.classItem?.year} Section ${unassignConfirm?.classItem?.section}? They will revert to regular department faculty and will no longer see this class's roster. All student and attendance data remains completely safe.`}
        confirmText="Relieve In-Charge"
        loading={unassigning}
        onConfirm={handleUnassign}
      />

      {/* ── Confirm Dialog: Demote HOD ── */}
      <ConfirmDialog
        open={Boolean(demoteHodConfirm)}
        onClose={() => setDemoteHodConfirm(null)}
        title="Demote HOD to Faculty?"
        text={`Are you sure you want to demote ${displayName(demoteHodConfirm?.hod)} from HOD of ${demoteHodConfirm?.department} to regular Faculty? Their dashboard will immediately switch to the Staff Dashboard. All department data and records remain completely safe.`}
        confirmText="Demote to Faculty"
        loading={demotingHod}
        onConfirm={handleDemoteHod}
      />
    </div>
  );
}

