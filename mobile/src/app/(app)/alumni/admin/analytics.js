import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import {
  Briefcase,
  Building,
  CalendarDays,
  GraduationCap,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react-native';
import {
  Badge,
  Card,
  ErrorState,
  Header,
  IconTile,
  Loading,
  PercentRing,
  ProgressBar,
  Screen,
  T,
} from '../../../../components/ui';
import { useGetAlumniAnalyticsQuery } from '../../../../services/api';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function AlumniAnalyticsScreen() {
  const { data, isLoading, error, refetch } = useGetAlumniAnalyticsQuery();

  if (isLoading) {
    return (
      <Screen>
        <Header back title="Alumni Analytics" />
        <Loading label="Computing alumni metrics..." />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <Header back title="Alumni Analytics" />
        <ErrorState error={error} onRetry={refetch} />
      </Screen>
    );
  }

  const totals = data.totals || {};
  const mentorship = data.mentorship || {};
  const jobs = data.jobs || {};
  const events = data.events || {};
  const chapters = data.chapters || {};
  const byDept = data.byDepartment || [];
  const topCompanies = data.topCompanies || [];

  return (
    <Screen>
      <Header back title="Alumni Analytics" subtitle="Program engagement & community KPI dashboard" />

      {/* Primary KPI Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Card style={styles.kpiCard}>
          <IconTile icon={GraduationCap} gradient={gradients.primary} size={40} />
          <View>
            <T v="h2">{totals.alumni || 0}</T>
            <T v="small">Total Alumni</T>
          </View>
        </Card>

        <Card style={styles.kpiCard}>
          <IconTile icon={UserCheck} gradient={gradients.emerald} size={40} />
          <View>
            <T v="h2">{totals.verified || 0}</T>
            <T v="small">Verified</T>
          </View>
        </Card>

        <Card style={styles.kpiCard}>
          <IconTile icon={Sparkles} gradient={gradients.violet} size={40} />
          <View>
            <T v="h2">{totals.mentors || 0}</T>
            <T v="small">Active Mentors</T>
          </View>
        </Card>

        <Card style={styles.kpiCard}>
          <IconTile icon={Briefcase} gradient={gradients.amber} size={40} />
          <View>
            <T v="h2">{jobs.openJobs || 0}</T>
            <T v="small">Open Jobs</T>
          </View>
        </Card>
      </View>

      {/* Mentorship Program Health */}
      <Card style={{ gap: 12 }}>
        <T v="h3">Mentorship Program</T>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ gap: 4 }}>
            <T v="strong">{mentorship.totalRequests || 0} Total Requests</T>
            <T v="small" style={{ color: colors.muted }}>
              {mentorship.acceptedRequests || 0} Accepted · {mentorship.completedRequests || 0} Completed
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T v="h2" style={{ color: colors.primary600 }}>{mentorship.avgRating ? `${mentorship.avgRating} ★` : '—'}</T>
            <T v="small">Avg Rating</T>
          </View>
        </View>

        {mentorship.totalRequests > 0 && (
          <View style={{ gap: 4 }}>
            <T v="small">Completion Rate</T>
            <ProgressBar value={((mentorship.completedRequests || 0) / mentorship.totalRequests) * 100} />
          </View>
        )}
      </Card>

      {/* Jobs & Referrals */}
      <Card style={{ gap: 12 }}>
        <T v="h3">Career Opportunities</T>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <T v="h2">{jobs.totalApplications || 0}</T>
            <T v="small">Student Applications</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T v="h2" style={{ color: colors.success }}>{jobs.referralConversion || 0}%</T>
            <T v="small">Referral Rate</T>
          </View>
        </View>
      </Card>

      {/* Events & Chapters */}
      <Card style={{ gap: 12 }}>
        <T v="h3">Events & Chapters</T>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
          <View style={{ alignItems: 'center' }}>
            <T v="h2">{events.upcomingEvents || 0}</T>
            <T v="small">Upcoming Events</T>
          </View>
          <View style={{ width: 1, height: 36, backgroundColor: colors.border }} />
          <View style={{ alignItems: 'center' }}>
            <T v="h2">{chapters.chapterCount || 0}</T>
            <T v="small">Active Chapters</T>
          </View>
          <View style={{ width: 1, height: 36, backgroundColor: colors.border }} />
          <View style={{ alignItems: 'center' }}>
            <T v="h2">{events.attendanceRate || 0}%</T>
            <T v="small">Check-in Rate</T>
          </View>
        </View>
      </Card>

      {/* Department Breakdown */}
      {byDept.length > 0 && (
        <Card style={{ gap: 10 }}>
          <T v="strong">Alumni by Department</T>
          {byDept.map((item, idx) => (
            <View key={idx} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="small" style={{ fontFamily: fonts.semibold }}>{item.department || item._id}</T>
                <T v="small" style={{ color: colors.muted }}>{item.count} alumni</T>
              </View>
              <ProgressBar value={(item.count / (totals.alumni || 1)) * 100} />
            </View>
          ))}
        </Card>
      )}

      {/* Top Hiring Companies */}
      {topCompanies.length > 0 && (
        <Card style={{ gap: 10 }}>
          <T v="strong">Top Alumni Employers</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {topCompanies.slice(0, 10).map((c, idx) => (
              <Badge key={idx} label={`${c.name || c._id} (${c.count})`} color="primary" />
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpiCard: {
    width: '47.8%',
    gap: 8,
  },
});
