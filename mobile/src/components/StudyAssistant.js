import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, ExternalLink, Globe, Send, Trash } from 'lucide-react-native';
import { errMsg, useAskStudyAssistantMutation, useDeleteAssistantConversationMutation } from '../services/api';
import { assetUrl } from '../config';
import { colors, fonts, gradients, radius, shadow } from '../theme';
import MarkdownText from './MarkdownText';

/**
 * JNN Study Assistant card for the mobile Study Materials screen. Calls the
 * same backend endpoint as the web app (JSON mode); the backend decides
 * which sources may be used and holds the AI key.
 */

const SUGGESTIONS = ['Explain a difficult topic', 'Summarize a concept', 'Analyze my study material', 'Find additional resources', 'Research a technical topic'];
const GROUPS = [
  { type: 'study_material', label: '📚 JNN Study Materials' },
  { type: 'web', label: '🌐 Web Research' },
  { type: 'dataset', label: '📊 Datasets' },
];

// Our own uploads resolve against the server; anything else must be http(s).
const hrefFor = (url) => (typeof url !== 'string' ? null : url.startsWith('/uploads/') ? assetUrl(url) : /^https?:\/\//i.test(url) ? url : null);

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <View style={s.sources}>
      <Text style={s.sourcesTitle}>SOURCES</Text>
      {GROUPS.map(({ type, label }) => {
        const items = sources.filter((x) => x.type === type);
        if (!items.length) return null;
        return (
          <View key={type} style={{ gap: 4 }}>
            <Text style={s.groupLabel}>{label}</Text>
            {items.map((src, i) => {
              const href = hrefFor(src.url);
              return (
                <Pressable key={i} disabled={!href} onPress={() => href && Linking.openURL(href)} style={s.sourceRow} accessibilityRole={href ? 'link' : undefined}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sourceTitle} numberOfLines={2}>
                      {src.title}
                      {src.page ? ` — Page ${src.page}` : ''}
                    </Text>
                    {src.publisher && src.publisher !== src.title ? <Text style={s.sourceSub} numberOfLines={1}>{src.publisher}</Text> : null}
                  </View>
                  {href ? <ExternalLink size={13} color={colors.muted} /> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function Bubble({ msg, onRetry }) {
  if (msg.role === 'user') {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.userBubble}>
          <Text style={s.userText}>{msg.content}</Text>
        </LinearGradient>
      </View>
    );
  }
  if (msg.error) {
    return (
      <View style={s.error} accessibilityRole="alert">
        <AlertTriangle size={15} color="#e11d48" />
        <Text style={s.errorText}>{msg.error}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text style={[s.errorText, { flex: 0, fontFamily: fonts.bold }]}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={s.aiBubble}>
      {msg.pending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.thinking}>Thinking…</Text>
        </View>
      ) : (
        <>
          <MarkdownText text={msg.content} />
          {msg.notices?.map((n) => (
            <Text key={n} style={s.notice}>{n}</Text>
          ))}
          <Sources sources={msg.sources} />
        </>
      )}
    </View>
  );
}

export default function StudyAssistant() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(true);
  const [ask, { isLoading: busy }] = useAskStudyAssistantMutation();
  const [remove] = useDeleteAssistantConversationMutation();
  const listRef = useRef(null);

  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages]);

  const send = async (text) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    const id = `p-${Date.now()}`;
    setMessages((m) => [...m.filter((x) => !x.error), { _id: `u-${id}`, role: 'user', content: question }, { _id: id, role: 'assistant', pending: true }]);
    try {
      const res = await ask({ conversationId: conversationId || undefined, message: question, useStudyMaterials: true, useWebSearch: webSearch }).unwrap();
      setConversationId(res.conversationId);
      setMessages((m) => m.map((x) => (x._id === id ? res.message : x)));
    } catch (e) {
      if (e?.status === 404) setConversationId(null);
      setMessages((m) => [...m.filter((x) => x._id !== id && x._id !== `u-${id}`), { _id: `e-${id}`, role: 'assistant', error: errMsg(e, 'The Study Assistant is unavailable right now.'), retry: question }]);
    }
  };

  const clear = () => {
    const id = conversationId;
    setMessages([]);
    setConversationId(null);
    if (id) remove(id);
  };

  return (
    <View style={s.card}>
      <View style={s.header}>
        <LinearGradient colors={['#4396EF', '#d946ef']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.logo}>
          <Text style={{ fontSize: 18 }}>🤖</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>JNN Study Assistant</Text>
          <Text style={s.subtitle} numberOfLines={2}>Ask questions, explore study resources, and learn with AI.</Text>
        </View>
        <Pressable
          onPress={() => setWebSearch((v) => !v)}
          style={[s.webChip, webSearch && s.webChipOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: webSearch }}
          accessibilityLabel="Web research"
        >
          <Globe size={12} color={webSearch ? '#fff' : colors.soft} />
          <Text style={[s.webChipText, webSearch && { color: '#fff' }]}>Web</Text>
        </Pressable>
        <Pressable onPress={clear} disabled={!messages.length} hitSlop={8} accessibilityLabel="Clear conversation" style={{ opacity: messages.length ? 1 : 0.35, padding: 4 }}>
          <Trash size={18} color={colors.soft} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m._id)}
        renderItem={({ item }) => <Bubble msg={item} onRetry={item.retry && !busy ? () => send(item.retry) : null} />}
        contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ gap: 10, paddingVertical: 8 }}>
            <Text style={s.emptyTitle}>👋 Hi! I'm JNN Study Assistant.</Text>
            <Text style={s.subtitle}>Ask me to:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((q) => (
                <Pressable key={q} onPress={() => setInput(`${q}: `)} style={s.suggestion}>
                  <Text style={s.suggestionText}>• {q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      <View style={s.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask JNN Study Assistant..."
          placeholderTextColor={colors.muted}
          multiline
          maxLength={4000}
          style={s.input}
          accessibilityLabel="Ask JNN Study Assistant"
        />
        <Pressable onPress={() => send(input)} disabled={busy || !input.trim()} accessibilityRole="button" accessibilityLabel="Send" style={{ opacity: busy || !input.trim() ? 0.5 : 1 }}>
          <LinearGradient colors={gradients.primary} style={s.send}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Send size={18} color="#fff" />}
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  logo: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.extrabold, fontSize: 15, color: colors.ink },
  subtitle: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.soft },
  webChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, paddingVertical: 5 },
  webChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  webChipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.soft },
  emptyTitle: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.ink },
  suggestion: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardStrong, paddingHorizontal: 12, paddingVertical: 7 },
  suggestionText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  userBubble: { maxWidth: '86%', borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: '#fff' },
  aiBubble: { alignSelf: 'stretch', backgroundColor: colors.cardStrong, borderRadius: 20, borderTopLeftRadius: 6, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
  thinking: { fontFamily: fonts.semibold, fontSize: 13, color: colors.soft },
  notice: { fontFamily: fonts.semibold, fontSize: 11.5, color: '#b45309', backgroundColor: colors.warningSoft, borderRadius: 10, padding: 8 },
  sources: { marginTop: 4, gap: 8, backgroundColor: colors.primary50, borderRadius: 14, padding: 10 },
  sourcesTitle: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, color: colors.soft },
  groupLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingLeft: 6 },
  sourceTitle: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary600 },
  sourceSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 10 },
  errorText: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, color: '#e11d48' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontFamily: fonts.regular, fontSize: 14, color: colors.ink },
  send: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
