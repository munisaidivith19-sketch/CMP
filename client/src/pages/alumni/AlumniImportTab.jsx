import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Copy,
  RotateCw,
  Ban,
  Download,
  Mail,
  Search,
  ArrowRight,
  ArrowLeft,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  usePreviewImportMutation,
  useCommitImportMutation,
  useGetInvitesQuery,
  useResendInviteMutation,
  useRevokeInviteMutation,
} from '../../services/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
} from '../../components/ui/primitives';
import { Field } from '../../components/ui/form';

const CSV_TEMPLATE = `name,email,department,gradYear,company,designation,location,phone
John Doe,john.doe@example.com,CSE,2022,Google India,Software Engineer,Bengaluru,9876543210
Jane Smith,jane.smith@example.com,ECE,2021,Qualcomm,Hardware Engineer,Hyderabad,9876543211`;

export default function AlumniImportTab() {
  const currentUser = useSelector(selectUser);

  // Wizard state: 1 (Upload), 2 (Preview), 3 (Committed)
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [batchData, setBatchData] = useState(null);
  const [sendEmails, setSendEmails] = useState(true);
  const [downloadLinksCsv, setDownloadLinksCsv] = useState(null);

  // Invites state
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');

  // RTK Query
  const [previewImport, { isLoading: isUploading }] = usePreviewImportMutation();
  const [commitImport, { isLoading: isCommitting }] = useCommitImportMutation();
  // The invites endpoint is paginated: { items, total, ... }, not a bare array.
  const { data: invitesPage, isLoading: isLoadingInvites, refetch: refetchInvites } = useGetInvitesQuery({
    search: inviteSearch.trim() || undefined,
    status: inviteStatus || undefined,
  });
  const invites = Array.isArray(invitesPage) ? invitesPage : invitesPage?.items ?? [];
  const totals = batchData?.totals;
  const [resendInvite] = useResendInviteMutation();
  const [revokeInvite] = useRevokeInviteMutation();

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'alumni_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handlePreviewUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please choose a CSV file to upload');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await previewImport(formData).unwrap();
      setBatchData(res);
      setStep(2);
      toast.success('CSV parsed and validated successfully!');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to preview CSV');
    }
  };

  const handleCommit = async () => {
    if (!batchData?._id) return;
    try {
      const res = await commitImport({ batchId: batchData._id, sendEmails }).unwrap();
      toast.success(`Batch processed! Created ${res.invitesCreated} alumni invitations.`);
      if (res.downloadLinksCsv) {
        setDownloadLinksCsv(res.downloadLinksCsv);
      }
      setStep(3);
      refetchInvites();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to commit import');
    }
  };

  const handleResend = async (id) => {
    try {
      const res = await resendInvite(id).unwrap();
      toast.success('Invitation token rotated and resent!');
      if (res.claimUrl) {
        navigator.clipboard.writeText(res.claimUrl);
        toast('Claim link copied to clipboard', { icon: '📋' });
      }
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to resend invite');
    }
  };

  const handleRevoke = async (id) => {
    if (!window.confirm('Are you sure you want to revoke this invitation?')) return;
    try {
      await revokeInvite(id).unwrap();
      toast.success('Invitation revoked');
      refetchInvites();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to revoke invite');
    }
  };

  const copyClaimLink = (token) => {
    const link = `${window.location.origin}/alumni/claim?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success('Claim URL copied to clipboard!');
  };

  return (
    <div className="space-y-8">
      {/* 3-Step Wizard Section */}
      <Card className="p-6">
        {/* Step Indicator Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-5 dark:border-white/5">
          <div>
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary-600" /> Bulk Alumni CSV Onboarding
            </h3>
            <p className="text-xs muted mt-0.5">
              Import alumni passout records and generate secure one-time activation links.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                step >= 1 ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              1
            </span>
            <span className={step >= 1 ? 'text-primary-600' : 'text-slate-400'}>Upload</span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                step >= 2 ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              2
            </span>
            <span className={step >= 2 ? 'text-primary-600' : 'text-slate-400'}>Preview</span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                step >= 3 ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              3
            </span>
            <span className={step >= 3 ? 'text-primary-600' : 'text-slate-400'}>Complete</span>
          </div>
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <form onSubmit={handlePreviewUpload} className="mt-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl bg-primary-50/60 dark:bg-primary-500/10">
              <div className="text-xs">
                <p className="font-bold text-primary-800 dark:text-primary-200">
                  Required Columns in CSV:
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  <code className="bg-white/80 dark:bg-black/30 px-1 py-0.5 rounded">name</code>,{' '}
                  <code className="bg-white/80 dark:bg-black/30 px-1 py-0.5 rounded">email</code>,{' '}
                  <code className="bg-white/80 dark:bg-black/30 px-1 py-0.5 rounded">department</code>,{' '}
                  <code className="bg-white/80 dark:bg-black/30 px-1 py-0.5 rounded">gradYear</code>
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="shrink-0 text-xs font-bold"
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Download Template CSV
              </Button>
            </div>

            <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-primary-500 transition-colors dark:border-white/20">
              <UploadCloud className="h-10 w-10 text-primary-500 mb-2" />
              <p className="text-sm font-bold">Select an Alumni Roster CSV File</p>
              <p className="text-xs muted mt-1">UTF-8 encoded CSV up to 2MB (max 1000 rows)</p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="mt-4 text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-primary-700"
              />
              {file && (
                <p className="mt-2 text-xs font-semibold text-emerald-600">
                  Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="primary" type="submit" loading={isUploading} disabled={!file}>
                Upload & Validate Records <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </form>
        )}

        {/* Step 2: Preview & Validation Table */}
        {step === 2 && batchData && (
          <div className="mt-6 space-y-5">
            {/* KPI Summary Tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-center text-xs">
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
                <p className="muted font-bold">Total Rows</p>
                <p className="text-xl font-extrabold mt-1">{totals?.rows || 0}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <p className="font-bold">Valid & Ready</p>
                <p className="text-xl font-extrabold mt-1">{totals?.valid || 0}</p>
              </div>
              <div className="rounded-2xl bg-rose-50 p-3 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-bold">Invalid</p>
                <p className="text-xl font-extrabold mt-1">{totals?.invalid || 0}</p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <p className="font-bold">Duplicates</p>
                <p className="text-xl font-extrabold mt-1">{totals?.duplicates || 0}</p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-800 dark:bg-blue-500/10 dark:text-blue-300">
                <p className="font-bold">Already Registered</p>
                <p className="text-xl font-extrabold mt-1">{totals?.alreadyExist || 0}</p>
              </div>
            </div>

            {/* Preview Table */}
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-[#1f2038] uppercase text-[10px] font-bold text-slate-500">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Dept & Batch</th>
                    <th className="p-3">Company</th>
                    <th className="p-3">Errors / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {batchData.rows?.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                      <td className="p-3 text-slate-400">{r.line || i + 1}</td>
                      <td className="p-3">
                        <Badge
                          color={
                            r.state === 'valid'
                              ? 'success'
                              : r.state === 'exists'
                              ? 'info'
                              : 'danger'
                          }
                        >
                          {r.state}
                        </Badge>
                      </td>
                      <td className="p-3 font-bold">{r.name}</td>
                      <td className="p-3">{r.email}</td>
                      <td className="p-3">
                        {r.department} ({r.gradYear})
                      </td>
                      <td className="p-3">{r.company || '—'}</td>
                      <td className="p-3 text-rose-500">{r.errors?.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Commit Option */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-slate-100 pt-4 dark:border-white/5">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold select-none">
                <input
                  type="checkbox"
                  checked={sendEmails}
                  onChange={(e) => setSendEmails(e.target.checked)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span>Email invitation claim links immediately to valid alumni</span>
              </label>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={isCommitting}
                  onClick={handleCommit}
                  disabled={!totals?.valid}
                  className="font-bold"
                >
                  Confirm & Generate Invites ({totals?.valid || 0})
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 3 && (
          <div className="mt-6 text-center py-6 space-y-4">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
            <h4 className="text-lg font-bold">Import Batch Committed Successfully!</h4>
            <p className="text-xs muted max-w-md mx-auto">
              Alumni invitation records have been created with 30-day secure expiration tokens. You can track activations in the table below.
            </p>

            {downloadLinksCsv && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob([downloadLinksCsv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', 'alumni_claim_links.csv');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="font-bold"
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> Download Generated Claim Links CSV
                </Button>
              </div>
            )}

            <Button variant="primary" size="sm" onClick={() => setStep(1)} className="mt-4">
              Import Another CSV
            </Button>
          </div>
        )}
      </Card>

      {/* Invites Management Table */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <Mail className="h-4 w-4" /> Alumni Invitation & Claim Tracker
            </h3>
            <p className="text-xs muted mt-0.5">
              Monitor claim status, copy direct links, or rotate expired invitation tokens.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-48">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search invites..."
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                className="input pl-9 text-xs"
              />
            </div>

            <select
              value={inviteStatus}
              onChange={(e) => setInviteStatus(e.target.value)}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="claimed">Claimed</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </div>

        {isLoadingInvites ? (
          <Skeleton className="h-40 w-full" />
        ) : invites.length === 0 ? (
          <p className="text-center py-8 text-xs muted">No invitation records found.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/5 uppercase text-[10px] font-bold text-slate-500">
                <tr>
                  <th className="p-3">Invitee Name</th>
                  <th className="p-3">Email Address</th>
                  <th className="p-3">Dept & Class</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Sent Count</th>
                  <th className="p-3">Expiry Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {invites.map((inv) => (
                  <tr key={inv._id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                    <td className="p-3 font-bold text-ink">{inv.name}</td>
                    <td className="p-3 text-slate-500">{inv.email}</td>
                    <td className="p-3">
                      {inv.department} (Class of {inv.gradYear})
                    </td>
                    <td className="p-3">
                      <Badge
                        color={
                          inv.status === 'claimed'
                            ? 'success'
                            : inv.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-slate-500">{inv.sentCount || 1} times</td>
                    <td className="p-3 text-slate-500">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {inv.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleResend(inv._id)}
                              title="Resend invitation email"
                              className="btn-icon btn-ghost h-7 w-7 text-primary-600"
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleRevoke(inv._id)}
                              title="Revoke invitation"
                              className="btn-icon btn-ghost h-7 w-7 text-rose-500"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        {inv.status === 'claimed' && (
                          <span className="text-[11px] font-bold text-emerald-600">Active User</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
