import { useState } from 'react';
import { FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  Briefcase,
  Building,
  CalendarDays,
  CheckCircle,
  ExternalLink,
  Filter,
  GraduationCap,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from 'lucide-react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  Input,
  Loading,
  Screen,
  Segmented,
  StatusBadge,
  T,
} from '../../../components/ui';
import {
  useCreateMentorshipRequestMutation,
  useGetAlumniFiltersQuery,
  useGetAlumniJobsQuery,
  useGetAlumniEventsQuery,
  useGetAlumniQuery,
  useGetChaptersQuery,
  useGetMentorshipRequestsQuery,
  useGetMyAlumniProfileQuery,
  useRespondMentorshipRequestMutation,
  useUpsertAlumniProfileMutation,
} from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../theme';

const TABS = [
  { value: 'directory', label: 'Directory' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'events', label: 'Events' },
  { value: 'chapters', label: 'Chapters' },
  { value: 'mentorship', label: 'Mentorship' },
  { value: 'profile', label: 'My Profile' },
];

const DOMAINS = [
  { key: 'software_engineering', label: 'Software Eng' },
  { key: 'data_science', label: 'Data & AI' },
  { key: 'core_engineering', label: 'Core Eng' },
  { key: 'cybersecurity', label: 'Cybersecurity' },
  { key: 'higher_studies', label: 'Higher Studies' },
  { key: 'entrepreneurship', label: 'Startups' },
];

export default function AlumniScreen() {
  const user = useSelector(selectUser);
  const [tab, setTab] = useState('directory');

  const isStaff = ['admin', 'hod', 'principal', 'dean', 'chairman'].includes(user?.role);
  const isAlumni = user?.role === 'alumni';
  const isStudent = ['student', 'club_admin'].includes(user?.role);

  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
        <Header
          back
          title="Alumni Network"
          subtitle="Connect with mentors, careers, and chapters."
          right={
            isStaff ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable
                  onPress={() => router.push('/alumni/admin/verification')}
                  style={styles.adminActionBtn}
                  accessibilityLabel="Verification queue"
                >
                  <UserCheck size={18} color={colors.primary600} />
                </Pressable>
                <Pressable
                  onPress={() => router.push('/alumni/admin/analytics')}
                  style={styles.adminActionBtn}
                  accessibilityLabel="Analytics"
                >
                  <TrendingUp size={18} color={colors.primary600} />
                </Pressable>
              </View>
            ) : null
          }
        />

        <Segmented options={TABS} value={tab} onChange={setTab} />
      </View>

      <View style={{ flex: 1, marginTop: 8 }}>
        {tab === 'directory' && <DirectoryTab user={user} isStudent={isStudent} />}
        {tab === 'jobs' && <JobsTab user={user} isAlumni={isAlumni} isStaff={isStaff} />}
        {tab === 'events' && <EventsTab user={user} isAlumni={isAlumni} isStaff={isStaff} />}
        {tab === 'chapters' && <ChaptersTab user={user} />}
        {tab === 'mentorship' && <MentorshipTab user={user} isStudent={isStudent} isAlumni={isAlumni} />}
        {tab === 'profile' && <MyProfileTab user={user} isAlumni={isAlumni} />}
      </View>
    </Screen>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 1. DIRECTORY TAB                                                    */
/* ─────────────────────────────────────────────────────────────────── */
function DirectoryTab({ user, isStudent }) {
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [mentorshipOnly, setMentorshipOnly] = useState(false);
  const [referralsOnly, setReferralsOnly] = useState(false);

  // Request Mentorship Modal state
  const [reqModalMentor, setReqModalMentor] = useState(null);
  const [reqDomain, setReqDomain] = useState('software_engineering');
  const [reqMessage, setReqMessage] = useState('');
  const [createMentorshipRequest, { isLoading: isSubmittingReq }] = useCreateMentorshipRequestMutation();

  const queryParams = {
    search: search.trim() || undefined,
    department: dept || undefined,
    mentorshipAvailable: mentorshipOnly ? 'true' : undefined,
    openToReferrals: referralsOnly ? 'true' : undefined,
    limit: 30,
  };

  const { data: filtersData } = useGetAlumniFiltersQuery();
  const { data, isLoading, isFetching, error, refetch } = useGetAlumniQuery(queryParams);

  const departments = filtersData?.departments || [];
  const alumniList = data?.items || [];

  const handleSendRequest = async () => {
    if (!reqModalMentor || reqMessage.trim().length < 5) return;
    try {
      await createMentorshipRequest({
        alumni: reqModalMentor.user?._id || reqModalMentor.user,
        domain: reqDomain,
        message: reqMessage.trim(),
      }).unwrap();
      setReqModalMentor(null);
      setReqMessage('');
    } catch (e) {
      alert(e?.data?.message || 'Could not send request');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Search and Filters */}
      <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 8 }}>
        <Input
          placeholder="Search name, company, skills..."
          value={search}
          onChangeText={setSearch}
          leftIcon={Search}
          style={{ marginBottom: 0 }}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip
            label="All Depts"
            active={!dept}
            onPress={() => setDept('')}
          />
          {departments.map((d) => (
            <Chip
              key={d}
              label={d}
              active={dept === d}
              onPress={() => setDept(dept === d ? '' : d)}
            />
          ))}
          <Chip
            label="Mentors Only"
            active={mentorshipOnly}
            onPress={() => setMentorshipOnly(!mentorshipOnly)}
          />
          <Chip
            label="Referrals Only"
            active={referralsOnly}
            onPress={() => setReferralsOnly(!referralsOnly)}
          />
        </ScrollView>
      </View>

      {isLoading ? (
        <Loading label="Loading directory..." />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={alumniList}
          keyExtractor={(item) => item._id || item.user?._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <EmptyState
              icon={GraduationCap}
              title="No Alumni Found"
              text="Try adjusting search or filters to see more alumni."
            />
          }
          renderItem={({ item }) => {
            const u = item.user || {};
            const userId = u._id || item.user;
            return (
              <Card
                onPress={() => router.push(`/alumni/${userId}`)}
                style={{ gap: 12 }}
              >
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Avatar user={u} name={u.name} size={48} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T v="strong" numberOfLines={1}>{u.name || 'Alumnus'}</T>
                      {item.isVerified && <Badge label="Verified" color="success" />}
                    </View>
                    <T v="small" numberOfLines={1} style={{ color: colors.ink }}>
                      {item.designation ? `${item.designation}` : ''}
                      {item.designation && item.company ? ' at ' : ''}
                      {item.company ? `${item.company}` : (u.designation || 'Alumnus')}
                    </T>
                    <T v="small" style={{ color: colors.muted }}>
                      {u.department} {item.gradYear ? `· Class of '${String(item.gradYear).slice(-2)}` : ''}
                    </T>
                  </View>
                </View>

                {/* Skills/Domains preview */}
                {item.skills && item.skills.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {item.skills.slice(0, 3).map((s, idx) => (
                      <View key={idx} style={styles.miniTag}>
                        <Text style={styles.miniTagText}>{s}</Text>
                      </View>
                    ))}
                    {item.skills.length > 3 && (
                      <Text style={[styles.miniTagText, { alignSelf: 'center', color: colors.soft }]}>
                        +{item.skills.length - 3} more
                      </Text>
                    )}
                  </View>
                )}

                {/* Action footer */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {item.mentorshipAvailable && (
                      <Badge label="Mentoring" color="primary" />
                    )}
                    {item.openToReferrals && (
                      <Badge label="Referrals" color="info" />
                    )}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {isStudent && item.mentorshipAvailable && (
                      <Button
                        title="Request"
                        small
                        variant="soft"
                        onPress={() => {
                          setReqModalMentor(item);
                          setReqDomain(item.domains?.[0] || 'software_engineering');
                          setReqMessage('');
                        }}
                      />
                    )}
                    <Button
                      title="Profile"
                      small
                      variant="outline"
                      onPress={() => router.push(`/alumni/${userId}`)}
                    />
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}

      {/* Mentorship Request Modal */}
      <Modal visible={Boolean(reqModalMentor)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Request Mentorship</T>
              <Pressable onPress={() => setReqModalMentor(null)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <T v="small">
              Request guidance from <Text style={{ fontFamily: fonts.bold }}>{reqModalMentor?.user?.name}</Text>
            </T>

            <View style={{ gap: 6 }}>
              <T v="label">Focus Domain</T>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {DOMAINS.map((d) => (
                  <Chip
                    key={d.key}
                    label={d.label}
                    active={reqDomain === d.key}
                    onPress={() => setReqDomain(d.key)}
                  />
                ))}
              </ScrollView>
            </View>

            <Input
              label="Note to mentor"
              placeholder="Explain your goals, questions, and what guidance you are seeking..."
              multiline
              numberOfLines={4}
              value={reqMessage}
              onChangeText={setReqMessage}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Button
                title="Cancel"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setReqModalMentor(null)}
              />
              <Button
                title="Send Request"
                style={{ flex: 1 }}
                loading={isSubmittingReq}
                disabled={reqMessage.trim().length < 5}
                onPress={handleSendRequest}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 2. JOBS TAB                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function JobsTab({ user, isAlumni, isStaff }) {
  const [filterMine, setFilterMine] = useState(false);
  const canPost = isAlumni || isStaff;

  const { data, isLoading, isFetching, error, refetch } = useGetAlumniJobsQuery(
    filterMine ? { mine: true } : {}
  );
  const jobsList = data?.items || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        {canPost ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All Open Roles" active={!filterMine} onPress={() => setFilterMine(false)} />
            <Chip label="Posted by Me" active={filterMine} onPress={() => setFilterMine(true)} />
          </ScrollView>
        ) : (
          <T v="small">Verified job postings and campus referrals</T>
        )}

        {canPost && (
          <Button
            title="Post Job"
            icon={Plus}
            small
            onPress={() => router.push('/alumni/jobs/new')}
          />
        )}
      </View>

      {isLoading ? (
        <Loading label="Loading opportunities..." />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={jobsList}
          keyExtractor={(j) => j._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <EmptyState
              icon={Briefcase}
              title="No Jobs Found"
              text="No open job listings right now. Check back soon!"
            />
          }
          renderItem={({ item: j }) => (
            <Card onPress={() => router.push(`/alumni/jobs/${j._id}`)} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <T v="strong" numberOfLines={1}>{j.title}</T>
                  <T v="small" style={{ color: colors.ink }}>{j.company}</T>
                </View>
                <Badge label={j.type.replace('_', ' ')} color="primary" />
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MapPin size={13} color={colors.soft} />
                  <T v="small">{j.location} ({j.workMode})</T>
                </View>
                {j.deadline && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CalendarDays size={13} color={colors.soft} />
                    <T v="small">Closes {format(new Date(j.deadline), 'MMM d')}</T>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                <T v="small" style={{ color: colors.muted }}>
                  Posted by {j.postedBy?.name || 'Alumnus'}
                </T>
                <T v="small" style={{ color: colors.primary600, fontFamily: fonts.bold }}>
                  View details →
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 3. EVENTS TAB                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function EventsTab({ user, isAlumni, isStaff }) {
  const [when, setWhen] = useState('upcoming');
  const canPropose = isAlumni || isStaff;

  const { data, isLoading, isFetching, error, refetch } = useGetAlumniEventsQuery({ when });
  const eventsList = data?.items || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Segmented
          value={when}
          onChange={setWhen}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'mine', label: 'My RSVPs' },
            { value: 'past', label: 'Past' },
          ]}
        />
        {canPropose && (
          <Button
            title="Host"
            icon={Plus}
            small
            variant="soft"
            onPress={() => router.push('/alumni/events/new')}
          />
        )}
      </View>

      {isLoading ? (
        <Loading label="Loading events..." />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={eventsList}
          keyExtractor={(e) => e._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <EmptyState
              icon={CalendarDays}
              title="No Events Found"
              text="No alumni reunions or sessions in this category."
            />
          }
          renderItem={({ item: e }) => (
            <Card onPress={() => router.push(`/alumni/events/${e._id}`)} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <T v="strong" numberOfLines={1}>{e.title}</T>
                  <T v="small" style={{ color: colors.muted }}>
                    {format(new Date(e.startsAt), 'EEE, MMM d, yyyy · h:mm a')}
                  </T>
                </View>
                <Badge label={e.type} color="info" />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MapPin size={13} color={colors.soft} />
                <T v="small">
                  {e.mode === 'virtual' ? 'Virtual (Meeting link upon RSVP)' : (e.venue || 'Campus')}
                </T>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                <T v="small" style={{ color: colors.muted }}>
                  {e.attendeeCount || 0} attending {e.capacity ? `/ ${e.capacity} max` : ''}
                </T>
                <T v="small" style={{ color: colors.primary600, fontFamily: fonts.bold }}>
                  {e.userRsvp ? 'Registered ✓' : 'RSVP →'}
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 4. CHAPTERS TAB                                                     */
/* ─────────────────────────────────────────────────────────────────── */
function ChaptersTab({ user }) {
  const { data: chapters = [], isLoading, isFetching, error, refetch } = useGetChaptersQuery();

  return (
    <View style={{ flex: 1 }}>
      {isLoading ? (
        <Loading label="Loading chapters..." />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(c) => c.slug || c._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <EmptyState
              icon={Users}
              title="No Chapters Yet"
              text="Regional and departmental chapters will appear here."
            />
          }
          renderItem={({ item: c }) => (
            <Card onPress={() => router.push(`/alumni/chapters/${c.slug}`)} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <T v="strong">{c.name}</T>
                  <T v="small" style={{ color: colors.muted }}>{c.type.toUpperCase()} CHAPTER</T>
                </View>
                <Badge label={`${c.memberCount || 0} members`} color="primary" />
              </View>

              {c.description ? (
                <T v="body" numberOfLines={2} style={{ color: colors.soft }}>
                  {c.description}
                </T>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                <T v="small" style={{ color: c.isMember ? colors.success : colors.soft, fontFamily: fonts.bold }}>
                  {c.isMember ? 'Joined Community ✓' : 'View Community Wall'}
                </T>
                <T v="small" style={{ color: colors.primary600, fontFamily: fonts.bold }}>
                  Open →
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 5. MENTORSHIP TAB                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function MentorshipTab({ user, isStudent, isAlumni }) {
  const { data, isLoading, isFetching, error, refetch } = useGetMentorshipRequestsQuery();
  const [respondRequest, { isLoading: isResponding }] = useRespondMentorshipRequestMutation();

  const requests = data?.items || [];

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
    >
      {/* Quick shortcuts */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Card
          onPress={() => router.push('/alumni/sessions')}
          style={{ flex: 1, gap: 6, alignItems: 'center' }}
        >
          <CalendarDays size={24} color={colors.primary} />
          <T v="strong">Sessions</T>
          <T v="small" style={{ textAlign: 'center' }}>Scheduled 1-on-1s</T>
        </Card>

        {isStudent && (
          <Card
            onPress={() => router.push('/alumni/sessions/book')}
            style={{ flex: 1, gap: 6, alignItems: 'center' }}
          >
            <Sparkles size={24} color={colors.primary} />
            <T v="strong">Book Slot</T>
            <T v="small" style={{ textAlign: 'center' }}>Choose a mentor slot</T>
          </Card>
        )}
      </View>

      <T v="h3">Mentorship Connections</T>

      {isLoading ? (
        <Loading label="Loading mentorships..." />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No Mentorship Requests"
          text={
            isStudent
              ? 'Find an alumnus in the Directory and request 1-on-1 mentorship.'
              : 'Students will reach out to you for mentorship guidance.'
          }
        />
      ) : (
        requests.map((r) => {
          const counterpart = isStudent ? r.alumni : r.student;
          return (
            <Card key={r._id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                  <Avatar user={counterpart} name={counterpart?.name} size={40} />
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>{counterpart?.name || 'User'}</T>
                    <T v="small" style={{ color: colors.muted }}>
                      {r.domain ? r.domain.replace('_', ' ') : 'General'}
                    </T>
                  </View>
                </View>
                <StatusBadge status={r.status} />
              </View>

              {r.message ? (
                <View style={{ backgroundColor: 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 10 }}>
                  <T v="small" style={{ color: colors.ink }}>"{r.message}"</T>
                </View>
              ) : null}

              {/* Mentor actions when pending */}
              {isAlumni && r.status === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <Button
                    title="Accept"
                    small
                    variant="success"
                    style={{ flex: 1 }}
                    loading={isResponding}
                    onPress={() => respondRequest({ id: r._id, status: 'accepted' })}
                  />
                  <Button
                    title="Decline"
                    small
                    variant="outline"
                    style={{ flex: 1 }}
                    loading={isResponding}
                    onPress={() => respondRequest({ id: r._id, status: 'declined' })}
                  />
                </View>
              )}

              {/* If accepted, shortcut to book session */}
              {r.status === 'accepted' && isStudent && (
                <Button
                  title="Book 1-on-1 Session"
                  small
                  variant="primary"
                  onPress={() => router.push(`/alumni/sessions/book?mentor=${r.alumni?._id || r.alumni}`)}
                />
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* 6. MY PROFILE TAB                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function MyProfileTab({ user, isAlumni }) {
  const { data: profile, isLoading, refetch } = useGetMyAlumniProfileQuery();
  const [upsertProfile, { isLoading: isSaving }] = useUpsertAlumniProfileMutation();

  const [company, setCompany] = useState('');
  const [designation, setDesignation] = useState('');
  const [location, setLocation] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [mentorshipAvailable, setMentorshipAvailable] = useState(false);
  const [maxActiveMentees, setMaxActiveMentees] = useState('3');
  const [openToReferrals, setOpenToReferrals] = useState(false);
  const [emailPrivacy, setEmailPrivacy] = useState('mentees');
  const [phonePrivacy, setPhonePrivacy] = useState('hidden');

  // Populate from query once loaded
  const [loaded, setLoaded] = useState(false);
  if (profile && !loaded) {
    setCompany(profile.company || '');
    setDesignation(profile.designation || '');
    setLocation(profile.location || profile.currentLocation || '');
    setGradYear(profile.gradYear ? String(profile.gradYear) : '');
    setSkillsText((profile.skills || []).join(', '));
    setMentorshipAvailable(Boolean(profile.mentorshipAvailable));
    setMaxActiveMentees(profile.maxActiveMentees ? String(profile.maxActiveMentees) : '3');
    setOpenToReferrals(Boolean(profile.openToReferrals));
    setEmailPrivacy(profile.privacy?.email || 'mentees');
    setPhonePrivacy(profile.privacy?.phone || 'hidden');
    setLoaded(true);
  }

  const handleSave = async () => {
    try {
      const skills = skillsText.split(',').map((s) => s.trim()).filter(Boolean);
      await upsertProfile({
        company: company.trim(),
        designation: designation.trim(),
        currentLocation: location.trim(),
        gradYear: gradYear ? parseInt(gradYear, 10) : undefined,
        skills,
        mentorshipAvailable,
        maxActiveMentees: parseInt(maxActiveMentees, 10) || 3,
        openToReferrals,
        privacy: {
          email: emailPrivacy,
          phone: phonePrivacy,
        },
      }).unwrap();
      alert('Profile updated successfully!');
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not update profile');
    }
  };

  if (isLoading) return <Loading label="Loading profile..." />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 14, paddingBottom: 60 }}>
      <Card style={{ gap: 10, alignItems: 'center' }}>
        <Avatar user={user} name={user?.name} size={64} />
        <T v="h3">{user?.name}</T>
        <T v="small">{user?.email} · {user?.department}</T>
        {profile?.isVerified ? (
          <Badge label="Verified Alumnus" color="success" />
        ) : (
          <Badge label="Verification Pending" color="warning" />
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <T v="strong">Career Details</T>
        <Input label="Current Company" value={company} onChangeText={setCompany} placeholder="e.g. Google, Qualcomm" />
        <Input label="Job Title / Designation" value={designation} onChangeText={setDesignation} placeholder="e.g. Senior Software Engineer" />
        <Input label="Location" value={location} onChangeText={setLocation} placeholder="e.g. Bengaluru, India" />
        <Input label="Graduation Year" value={gradYear} onChangeText={setGradYear} keyboardType="numeric" placeholder="e.g. 2022" />
        <Input label="Skills (comma-separated)" value={skillsText} onChangeText={setSkillsText} placeholder="React, Node.js, Python, System Design" />
      </Card>

      <Card style={{ gap: 12 }}>
        <T v="strong">Mentorship & Referrals</T>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T v="body">Available for 1-on-1 Mentorship</T>
          <Chip
            label={mentorshipAvailable ? 'Enabled' : 'Disabled'}
            active={mentorshipAvailable}
            onPress={() => setMentorshipAvailable(!mentorshipAvailable)}
          />
        </View>

        {mentorshipAvailable && (
          <Input
            label="Maximum Active Mentees"
            value={maxActiveMentees}
            onChangeText={setMaxActiveMentees}
            keyboardType="numeric"
            placeholder="3"
          />
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
          <T v="body">Open to Job Referrals</T>
          <Chip
            label={openToReferrals ? 'Yes' : 'No'}
            active={openToReferrals}
            onPress={() => setOpenToReferrals(!openToReferrals)}
          />
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <T v="strong">Privacy Settings</T>
        <T v="small">Control who can see your contact info on your public profile</T>

        <View style={{ gap: 6 }}>
          <T v="label">Email Visibility</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {['public', 'mentees', 'hidden'].map((lvl) => (
              <Chip
                key={lvl}
                label={lvl === 'mentees' ? 'Accepted Mentees Only' : lvl}
                active={emailPrivacy === lvl}
                onPress={() => setEmailPrivacy(lvl)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={{ gap: 6 }}>
          <T v="label">Phone Visibility</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {['public', 'mentees', 'hidden'].map((lvl) => (
              <Chip
                key={lvl}
                label={lvl === 'mentees' ? 'Accepted Mentees Only' : lvl}
                active={phonePrivacy === lvl}
                onPress={() => setPhonePrivacy(lvl)}
              />
            ))}
          </ScrollView>
        </View>
      </Card>

      <Button title="Save Profile" loading={isSaving} onPress={handleSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  adminActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTag: {
    backgroundColor: colors.primarySoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  miniTagText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary600,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
    maxHeight: '85%',
  },
});
