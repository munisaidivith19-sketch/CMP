import { forwardRef } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { ChevronLeft } from 'lucide-react-native';
import { assetUrl } from '../config';
import { colors, fonts, gradients, radius, shadow } from '../theme';

/* ── Typography ─────────────────────────────────────────────────── */
const VARIANTS = {
  h1: { fontFamily: fonts.extrabold, fontSize: 26, color: colors.ink, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.extrabold, fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  h3: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, lineHeight: 20 },
  strong: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  small: { fontFamily: fonts.semibold, fontSize: 12, color: colors.soft },
  label: { fontFamily: fonts.bold, fontSize: 11, color: colors.soft, textTransform: 'uppercase', letterSpacing: 0.8 },
};
export function T({ v = 'body', style, children, ...props }) {
  return (
    <Text style={[VARIANTS[v], style]} {...props}>
      {children}
    </Text>
  );
}

/* ── Layout ─────────────────────────────────────────────────────── */
export function Screen({ children, scroll = true, refreshing = false, onRefresh, contentStyle, edges = ['top'] }) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.blob, { top: -120, left: -100, backgroundColor: 'rgba(67,150,239,0.16)' }]} />
        <View style={[styles.blob, { top: 180, right: -140, backgroundColor: 'rgba(29,111,235,0.1)' }]} />
      </View>
      <Body
        style={{ flex: 1 }}
        {...(scroll
          ? {
              contentContainerStyle: [{ padding: 16, paddingBottom: 40, gap: 14 }, contentStyle],
              keyboardShouldPersistTaps: 'handled',
              refreshControl: onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined,
            }
          : {})}
      >
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, back, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 }}>
      {back && (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={colors.ink} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <T v="h1" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T v="small" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const LAYOUT_KEYS = ['width', 'minWidth', 'maxWidth', 'flex', 'flexBasis', 'flexGrow', 'alignSelf', 'margin', 'marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical'];

export function Card({ children, style, onPress, padded = true }) {
  if (!onPress) return <View style={[styles.card, padded && { padding: 16 }, style]}>{children}</View>;
  // Layout keys belong on the pressable wrapper so % widths and flex resolve against the real parent.
  const flat = StyleSheet.flatten(style) || {};
  const outer = Object.fromEntries(Object.entries(flat).filter(([k]) => LAYOUT_KEYS.includes(k)));
  const inner = Object.fromEntries(Object.entries(flat).filter(([k]) => !LAYOUT_KEYS.includes(k)));
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [outer, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
      <View style={[styles.card, padded && { padding: 16 }, { flexGrow: 1 }, inner]}>{children}</View>
    </Pressable>
  );
}

export function SectionTitle({ title, action, onAction }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
      <T v="h3">{title}</T>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <T v="small" style={{ color: colors.primary, fontFamily: fonts.bold }}>
            {action}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Buttons ────────────────────────────────────────────────────── */
export function Button({ title, onPress, variant = 'primary', loading, disabled, icon: Icon, small, style }) {
  const isPrimary = variant === 'primary';
  const palette = {
    soft: { bg: colors.primarySoft, fg: colors.primary600 },
    ghost: { bg: 'transparent', fg: colors.soft },
    outline: { bg: 'rgba(255,255,255,0.6)', fg: colors.ink },
    danger: { bg: colors.dangerSoft, fg: '#e11d48' },
    success: { bg: colors.successSoft, fg: '#059669' },
  }[variant];
  const inner = (
    <View style={[styles.btn, small && styles.btnSmall, !isPrimary && { backgroundColor: palette.bg }, variant === 'outline' && { borderWidth: 1, borderColor: colors.border }]}>
      {loading ? <ActivityIndicator size="small" color={isPrimary ? '#fff' : palette.fg} /> : Icon ? <Icon size={small ? 14 : 16} color={isPrimary ? '#fff' : palette.fg} /> : null}
      {title ? <Text style={[styles.btnText, small && { fontSize: 12 }, { color: isPrimary ? '#fff' : palette.fg }]}>{title}</Text> : null}
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}
    >
      {isPrimary ? (
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius.md }, shadow]}>
          {inner}
        </LinearGradient>
      ) : (
        inner
      )}
    </Pressable>
  );
}

export function IconButton({ icon: Icon, onPress, label, color = colors.ink, style }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }, style]}>
      <Icon size={20} color={color} />
    </Pressable>
  );
}

/* ── Inputs ─────────────────────────────────────────────────────── */
export const Input = forwardRef(function Input({ label, error, hint, style, multiline, ...props }, ref) {
  return (
    <View style={style}>
      {label ? <T v="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }, error && { borderColor: colors.danger }]}
        {...props}
      />
      {error ? <T v="small" style={{ color: colors.danger, marginTop: 4 }}>{error.message || error}</T> : hint ? <T v="small" style={{ marginTop: 4 }}>{hint}</T> : null}
    </View>
  );
});

/** Pill segmented control (the web's <Tabs>). */
export function Segmented({ options, value, onChange, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={styles.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.segmentItem, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, active && { color: colors.primary600 }]}>
              {o.label}
              {o.count ? ` · ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/* ── Status + identity ──────────────────────────────────────────── */
const BADGE = {
  primary: [colors.primarySoft, colors.primary600],
  success: [colors.successSoft, '#059669'],
  warning: [colors.warningSoft, '#b45309'],
  danger: [colors.dangerSoft, '#e11d48'],
  info: [colors.infoSoft, '#0284c7'],
  neutral: [colors.neutralSoft, '#475569'],
};
export function Badge({ label, color = 'primary', style }) {
  const [bg, fg] = BADGE[color] || BADGE.primary;
  return (
    <View style={[{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }, style]}>
      <Text style={{ color: fg, fontFamily: fonts.bold, fontSize: 11, textTransform: 'capitalize' }}>{label}</Text>
    </View>
  );
}

const STATUS_COLOR = {
  pending: 'warning', approved: 'success', active: 'info', completed: 'neutral', rejected: 'danger', revoked: 'danger',
  expired: 'neutral', cancelled: 'neutral', lost: 'danger', found: 'info', possible_match: 'warning',
  under_verification: 'primary', returned: 'success', closed: 'neutral', present: 'success', absent: 'danger',
  registered: 'success', waitlisted: 'warning', attended: 'primary',
};
export const StatusBadge = ({ status, label }) => <Badge label={label || String(status).replace(/_/g, ' ')} color={STATUS_COLOR[status] || 'neutral'} />;

const AVATAR_GRADS = [gradients.violet, gradients.rose, gradients.sky, gradients.amber, gradients.emerald, ['#e879f9', '#a855f7']];
const initials = (n = '?') => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export function Avatar({ user, name, uri, size = 40, online }) {
  const n = name || user?.name || '?';
  const src = assetUrl(uri || user?.avatar || user?.logo);
  const grad = AVATAR_GRADS[(n.charCodeAt(0) + n.length) % AVATAR_GRADS.length];
  const r = size * 0.36;
  return (
    <View style={{ width: size, height: size }}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: r }} accessibilityLabel={n} />
      ) : (
        <LinearGradient colors={grad} style={{ width: size, height: size, borderRadius: r, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: size * 0.34 }}>{initials(n)}</Text>
        </LinearGradient>
      )}
      {online ? <View style={[styles.online, { width: size * 0.3, height: size * 0.3, borderRadius: size }]} accessibilityLabel="online" /> : null}
    </View>
  );
}

/** Rounded gradient tile with an icon (used for quick links and stats). */
export function IconTile({ icon: Icon, gradient = gradients.primary, size = 44 }) {
  return (
    <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={size * 0.45} color="#fff" />
    </LinearGradient>
  );
}

/* ── Feedback states ────────────────────────────────────────────── */
export function Loading({ label }) {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <T v="small">{label}</T> : null}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, gap: 8 }}>
      {Icon ? (
        <View style={{ width: 60, height: 60, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <Icon size={26} color={colors.primary} />
        </View>
      ) : null}
      <T v="h3" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {text ? (
        <T v="small" style={{ textAlign: 'center' }}>
          {text}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }) {
  const message = error?.data?.message || (error?.status === 'FETCH_ERROR' ? 'Cannot reach the Vexon server. Check your connection.' : 'Could not load data');
  return (
    <Card style={{ alignItems: 'center', gap: 10 }}>
      <T v="strong" style={{ color: '#e11d48', textAlign: 'center' }}>
        {message}
      </T>
      {onRetry ? <Button title="Try again" variant="soft" small onPress={onRetry} /> : null}
    </Card>
  );
}

/* ── Progress ───────────────────────────────────────────────────── */
export const pctColor = (v, threshold = 75) => (v >= threshold ? colors.success : v >= threshold - 10 ? colors.warning : colors.danger);

export function PercentRing({ value = 0, size = 120, stroke = 11, threshold = 75, sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${pct} percent`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(29,111,235,0.14)" strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={pctColor(pct, threshold)} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c - (pct / 100) * c} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <T v="h2">{+pct.toFixed(2)}%</T>
        {sub ? <T v="small">{sub}</T> : null}
      </View>
    </View>
  );
}

export function ProgressBar({ value = 0, threshold = 75 }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height: 8, borderRadius: 8, backgroundColor: colors.primarySoft, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 8, backgroundColor: pctColor(pct, threshold) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  blob: { position: 'absolute', width: 340, height: 340, borderRadius: 340 },
  // Android draws elevation shadows *through* translucent backgrounds (a pale inner
  // rectangle), so glass cards there get no elevation and a slightly firmer fill.
  card: Platform.select({
    android: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
    default: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, ...shadow },
  }),
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 13 },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm },
  btnText: { fontFamily: fonts.bold, fontSize: 14 },
  iconBtn: { width: 40, height: 40, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.ink },
  segment: { backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 18, padding: 4, gap: 4, borderWidth: 1, borderColor: colors.border },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14 },
  segmentActive: { backgroundColor: '#fff', ...shadow, shadowOpacity: 0.08 },
  segmentText: { fontFamily: fonts.bold, fontSize: 13, color: colors.soft },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.8)' },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.soft },
  online: { position: 'absolute', right: -1, bottom: -1, backgroundColor: colors.success, borderWidth: 2, borderColor: '#fff' },
});
