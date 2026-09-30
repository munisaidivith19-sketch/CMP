import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, Clock, EyeOff, MessageSquareWarning, Plus, TrendingUp, XCircle } from 'lucide-react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, IconTile, Loading, Screen, StatusBadge, T } from '../../../components/ui';
import { useGetComplaintDashboardQuery, useGetComplaintsQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUSES, DEPARTMENTS, colors, gradients } from '../../../theme';
import { timeAgo, titleCase } from '../../../utils/format';

const categoryLabel = (c) => COMPLAINT_CATEGORY_LABELS[c] || titleCase(c);

function ComplaintCard({ c, showDepartment }) {
  return (
    <Card onPress={() => router.push(`/complaints/${c._id}`)} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MessageSquareWarning size={16} color={colors.primary} />
        <T v="strong" style={{ flex: 1 }} numberOfLines={1}>
          {categoryLabel(c.category)}
          {c.subCategory ? ` · ${titleCase(c.subCategory)}` : ''}
        </T>
        <StatusBadge status={c.status} />
      </View>
      {c.anonymous ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <EyeOff size={12} color={colors.soft} />
          <T v="small">Anonymous</T>
        </View>
      ) : null}
      <T v="small" style={{ color: colors.muted }}>
        {c.complaintCode}
        {showDepartment ? ` · ${c.department || 'College-wide'}` : ''} · Assigned to {titleCase(c.currentAuthorityRole)} · Updated {timeAgo(c.updatedAt)}
      </T>
    </Card>
  );
}

function Pager({ pagination, onChange }) {
  if (!pagination || pagination.pages <= 1) return null;
  const { page, pages } = pagination;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Button small variant="soft" title="Previous" disabled={page <= 1} onPress={() => onChange(page - 1)} />
      <T v="small">
        Page {page} of {pages}
      </T>
      <Button small variant="soft" title="Next" disabled={page >= pages} onPress={() => onChange(page + 1)} />
    </View>
  );
}

function ComplaintList({ query, empty, showDepartment, onPage }) {
  const { data, isLoading, error, refetch } = query;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.complaints.length) return <Card>{empty}</Card>;
  return (
    <>
      {data.complaints.map((c) => (
        <ComplaintCard key={c._id} c={c} showDepartment={showDepartment} />
      ))}
      <Pager pagination={data.pagination} onChange={onPage} />
    </>
  );
}

function StudentComplaints() {
  const [page, setPage] = useState(1);
  const query = useGetComplaintsQuery({ page, limit: 12 });
  const register = () => router.push('/complaints/new');
  return (
    <Screen refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch}>
      <Header back title="Complaints" subtitle="Register and track complaints — academics, ragging & harassment, infrastructure or hostel." />
      <Button title="Register complaint" icon={Plus} onPress={register} />
      <ComplaintList
        query={query}
        onPage={setPage}
        empty={
          <EmptyState
            icon={MessageSquareWarning}
            title="No complaints yet"
            text="Raised a concern? Register it here and we'll route it to the right authority."
          />
        }
      />
    </Screen>
  );
}

function AuthorityComplaints() {
  const [page, setPage] = useState(1);
  const query = useGetComplaintsQuery({ page, limit: 12 });
  return (
    <Screen refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch}>
      <Header back title="Complaints assigned to you" subtitle="Complaints currently waiting on your review." />
      <ComplaintList
        query={query}
        onPage={setPage}
        empty={<EmptyState icon={CheckCircle2} title="Nothing assigned to you" text="New complaints appear here the moment they're routed to you." />}
      />
    </Screen>
  );
}

function Stat({ icon, gradient, label, value, hint }) {
  return (
    <Card style={{ width: '47.8%', gap: 8 }}>
      <IconTile icon={icon} gradient={gradient} size={36} />
      <View>
        <T v="label">{label}</T>
        <T v="h2">{value}</T>
        {hint ? <T v="small">{hint}</T> : null}
      </View>
    </Card>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => (
          <Chip key={o.value || 'all'} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}

/** Admin / Chairman: the web's college-wide Complaints dashboard (stats + filters + list). */
function ComplaintDashboard() {
  const [filters, setFilters] = useState({ department: '', category: '', status: '', anonymous: '' });
  const [page, setPage] = useState(1);
  const dash = useGetComplaintDashboardQuery({ department: filters.department || undefined, category: filters.category || undefined });
  const query = useGetComplaintsQuery({
    page,
    limit: 15,
    department: filters.department || undefined,
    category: filters.category || undefined,
    status: filters.status || undefined,
    anonymous: filters.anonymous || undefined,
  });
  const set = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const d = dash.data;

  return (
    <Screen
      refreshing={query.isFetching && !query.isLoading}
      onRefresh={() => {
        dash.refetch();
        query.refetch();
      }}
    >
      <Header back title="Complaints" subtitle="College-wide complaint monitoring, filters and statistics." />
      {dash.isLoading ? (
        <Loading />
      ) : dash.error ? (
        <ErrorState error={dash.error} onRetry={dash.refetch} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <Stat icon={MessageSquareWarning} gradient={gradients.primary} label="Total" value={d.total} />
          <Stat icon={Clock} gradient={gradients.amber} label="Open" value={d.open} hint={`${d.pending} pending`} />
          <Stat icon={CheckCircle2} gradient={gradients.emerald} label="Resolved" value={d.resolved} />
          <Stat icon={TrendingUp} gradient={gradients.violet} label="Escalated" value={d.escalated} hint={`${d.cancelled} cancelled`} />
        </View>
      )}

      <Card style={{ gap: 12 }}>
        <T v="h3">Filters</T>
        <FilterRow
          label="Department"
          value={filters.department}
          onChange={(v) => set('department', v)}
          options={[{ value: '', label: 'All' }, ...DEPARTMENTS.map((x) => ({ value: x, label: x }))]}
        />
        <FilterRow
          label="Category"
          value={filters.category}
          onChange={(v) => set('category', v)}
          options={[{ value: '', label: 'All' }, ...Object.entries(COMPLAINT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]}
        />
        <FilterRow
          label="Status"
          value={filters.status}
          onChange={(v) => set('status', v)}
          options={[{ value: '', label: 'Any' }, ...COMPLAINT_STATUSES.map((s) => ({ value: s, label: titleCase(s.toLowerCase()) }))]}
        />
        <FilterRow
          label="Identity"
          value={filters.anonymous}
          onChange={(v) => set('anonymous', v)}
          options={[
            { value: '', label: 'Anonymous & visible' },
            { value: 'true', label: 'Anonymous only' },
            { value: 'false', label: 'Visible only' },
          ]}
        />
      </Card>

      <ComplaintList query={query} onPage={setPage} showDepartment empty={<EmptyState icon={XCircle} title="No complaints match these filters" />} />
    </Screen>
  );
}

export default function Complaints() {
  const me = useSelector(selectUser);
  if (me.role === 'student') return <StudentComplaints />;
  if (['admin', 'chairman'].includes(me.role)) return <ComplaintDashboard />;
  return <AuthorityComplaints />;
}
