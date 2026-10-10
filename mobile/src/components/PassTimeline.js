import { View } from 'react-native';
import { CheckCircle2, Clock, XCircle } from 'lucide-react-native';
import { T } from './ui';
import { AUTHORITY_LABELS, isEmergency } from './EmergencyGatePass';
import { colors } from '../theme';
import { timeAgo, titleCase } from '../utils/format';

/** A day scholar's same-day Outing (no destination, no return step). */
const isOuting = (p) => Boolean(p?.dayScholarOuting);

function Step({ label, at, done, bad, note }) {
  const Icon = done ? (bad ? XCircle : CheckCircle2) : Clock;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Icon size={20} color={done ? (bad ? colors.danger : colors.success) : colors.muted} />
      <View style={{ flex: 1 }}>
        <T v="strong" style={!done && { color: colors.muted }}>
          {label}
        </T>
        {done && at ? <T v="small">{timeAgo(at)}</T> : null}
        {note ? <T v="small" style={{ color: colors.danger }}>“{note}”</T> : null}
      </View>
    </View>
  );
}

/**
 * The gate-pass approval progress — the same stages the web shows
 * (Requested → Parent OTP → Faculty → HOD → Principal → Left campus → Returned).
 * Shared by the student's current-pass card and the gate-pass detail screen so
 * both read identically. Review timestamps/reasons come straight from the pass
 * document; the server is the source of truth for every stage.
 */
export default function PassTimeline({ pass }) {
  if (!pass) return null;
  const stageStep = (label, review, atFallback) => ({
    label,
    at: review?.at || atFallback,
    done: Boolean(review),
    bad: review?.action === 'rejected',
    note: review?.action === 'rejected' ? review.reason : null,
  });
  const approvalSteps = isEmergency(pass)
    ? [stageStep(`${AUTHORITY_LABELS[pass.emergencyAuthority]} approval`, pass.emergencyReview)]
    : [
        // Passes forwarded before parent OTP verification existed have no such step.
        ...(pass.parentVerifiedAt || ['pending_faculty', 'parent_verified'].includes(pass.status)
          ? [{ label: 'Parent verified (OTP)', at: pass.parentVerifiedAt, done: Boolean(pass.parentVerifiedAt) }]
          : []),
        stageStep('Faculty review', pass.facultyReview),
        stageStep('HOD review', pass.hodReview),
        stageStep('Principal approval', pass.principalReview),
      ];
  const steps = [
    { label: 'Requested', at: pass.createdAt, done: true },
    ...approvalSteps,
    // An Outing has no return step: leaving campus completes it.
    ...(isOuting(pass)
      ? [{ label: 'Left campus · outing complete', at: pass.actualExit, done: Boolean(pass.actualExit) }]
      : [
          { label: 'Left campus', at: pass.actualExit, done: Boolean(pass.actualExit) },
          ...(pass.actualExit && pass.returnOverride?.at && !pass.returnLocationVerifiedAt
            ? [{ label: 'Return approved by Admin', at: pass.returnOverride.at, done: true }]
            : pass.actualExit
              ? [{ label: 'Return location verified', at: pass.returnLocationVerifiedAt, done: Boolean(pass.returnLocationVerifiedAt) }]
              : []),
          { label: 'Returned', at: pass.actualReturn, done: Boolean(pass.actualReturn) },
        ]),
  ];
  if (['cancelled', 'revoked', 'expired'].includes(pass.status)) {
    steps.push({ label: titleCase(pass.status), at: pass.cancelledAt || pass.revokedAt || pass.verificationExpiry, done: true, bad: true });
  }
  return (
    <View style={{ gap: 14 }}>
      {steps.map((s) => (
        <Step key={s.label} label={s.label} at={s.at} done={s.done} bad={s.bad} note={s.note} />
      ))}
    </View>
  );
}
