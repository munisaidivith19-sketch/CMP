import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSelector } from 'react-redux';
import { formatDistanceToNow } from 'date-fns';
import {
  Heart,
  MessageSquare,
  Pin,
  Send,
  Share2,
  Users,
  X,
} from 'lucide-react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  Input,
  Loading,
  Screen,
  T,
} from '../../../../components/ui';
import {
  useAddCommentMutation,
  useCreateChapterPostMutation,
  useGetChapterPostsQuery,
  useGetChapterQuery,
  useGetCommentsQuery,
  useJoinChapterMutation,
  useLeaveChapterMutation,
  useLikePostMutation,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function ChapterWallScreen() {
  const { slug } = useLocalSearchParams();
  const currentUser = useSelector(selectUser);

  const { data: chapter, isLoading: isChapterLoading, error: chapterError, refetch: refetchChapter } = useGetChapterQuery(slug);
  const { data: postsData, isLoading: isPostsLoading, isFetching, refetch: refetchPosts } = useGetChapterPostsQuery({ slug });

  const [joinChapter, { isLoading: isJoining }] = useJoinChapterMutation();
  const [leaveChapter, { isLoading: isLeaving }] = useLeaveChapterMutation();
  const [createPost, { isLoading: isPosting }] = useCreateChapterPostMutation();
  const [likePost] = useLikePostMutation();

  const [postText, setPostText] = useState('');
  const [activeCommentPost, setActiveCommentPost] = useState(null);

  const isStaff = ['admin', 'hod', 'principal'].includes(currentUser?.role);
  const isStudent = ['student', 'club_admin'].includes(currentUser?.role);

  if (isChapterLoading) {
    return (
      <Screen>
        <Header back title="Chapter Wall" />
        <Loading label="Loading community..." />
      </Screen>
    );
  }

  if (chapterError || !chapter) {
    return (
      <Screen>
        <Header back title="Chapter Wall" />
        <ErrorState error={chapterError} onRetry={refetchChapter} />
      </Screen>
    );
  }

  const posts = postsData?.items || [];
  const isMember = Boolean(chapter.isMember);
  const canPost = !isStudent && (isMember || isStaff);

  const handleToggleJoin = async () => {
    try {
      if (isMember) {
        await leaveChapter(slug).unwrap();
      } else {
        await joinChapter(slug).unwrap();
      }
      refetchChapter();
    } catch (e) {
      alert(e?.data?.message || 'Could not update membership');
    }
  };

  const handleCreatePost = async () => {
    if (!postText.trim()) return;
    try {
      await createPost({ slug, body: postText.trim() }).unwrap();
      setPostText('');
      refetchPosts();
    } catch (e) {
      alert(e?.data?.message || 'Could not create post');
    }
  };

  const handleToggleLike = async (postId) => {
    try {
      await likePost(postId).unwrap();
      refetchPosts();
    } catch (e) {
      // silent
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 10 }}>
        <Header back title={chapter.name} subtitle={`${chapter.type.toUpperCase()} CHAPTER · ${chapter.memberCount || 0} Members`} />

        {/* Chapter description & Join toggle */}
        <Card style={{ padding: 12, gap: 8 }}>
          {chapter.description ? (
            <T v="body" style={{ color: colors.soft }}>{chapter.description}</T>
          ) : null}

          {!isStudent && (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
              <Button
                title={isMember ? 'Leave Chapter' : 'Join Chapter'}
                variant={isMember ? 'outline' : 'primary'}
                small
                loading={isJoining || isLeaving}
                onPress={handleToggleJoin}
              />
            </View>
          )}
        </Card>

        {/* Post Composer for members */}
        {canPost && (
          <Card style={{ padding: 12, gap: 8 }}>
            <Input
              placeholder="Share an update or question with the chapter..."
              multiline
              numberOfLines={2}
              value={postText}
              onChangeText={setPostText}
              style={{ marginBottom: 0 }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button
                title="Post"
                small
                disabled={!postText.trim()}
                loading={isPosting}
                onPress={handleCreatePost}
              />
            </View>
          </Card>
        )}
      </View>

      {/* Posts Feed */}
      <View style={{ flex: 1, marginTop: 8 }}>
        {isPostsLoading ? (
          <Loading label="Loading posts..." />
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(p) => p._id}
            refreshing={isFetching && !isPostsLoading}
            onRefresh={refetchPosts}
            contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 40 }}
            ListEmptyComponent={
              <EmptyState
                icon={MessageSquare}
                title="No Posts Yet"
                text="Be the first to share an update or question in this chapter."
              />
            }
            renderItem={({ item: p }) => {
              const author = p.author || {};
              const timeStr = p.createdAt ? formatDistanceToNow(new Date(p.createdAt), { addSuffix: true }) : '';
              return (
                <Card style={{ gap: 10 }}>
                  {/* Author Header */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                      <Avatar user={author} name={author.name} size={38} />
                      <View style={{ flex: 1 }}>
                        <T v="strong" numberOfLines={1}>{author.name || 'Alumnus'}</T>
                        <T v="small" style={{ color: colors.muted }}>
                          {author.department || author.role} · {timeStr}
                        </T>
                      </View>
                    </View>
                    {p.pinned && <Badge label="Pinned" color="primary" />}
                  </View>

                  {/* Body */}
                  <T v="body" style={{ color: colors.ink, lineHeight: 22 }}>
                    {p.body}
                  </T>

                  {/* Interactions Footer */}
                  <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                    <Pressable
                      onPress={() => handleToggleLike(p._id)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Heart
                        size={18}
                        color={p.hasLiked ? '#e11d48' : colors.soft}
                        fill={p.hasLiked ? '#e11d48' : 'none'}
                      />
                      <T v="small" style={{ color: p.hasLiked ? '#e11d48' : colors.soft }}>
                        {p.likesCount || 0}
                      </T>
                    </Pressable>

                    <Pressable
                      onPress={() => setActiveCommentPost(p)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <MessageSquare size={18} color={colors.soft} />
                      <T v="small" style={{ color: colors.soft }}>
                        {p.commentsCount || 0} Comments
                      </T>
                    </Pressable>
                  </View>
                </Card>
              );
            }}
          />
        )}
      </View>

      {/* Comments Sheet Modal */}
      {activeCommentPost && (
        <CommentsModal
          post={activeCommentPost}
          onClose={() => setActiveCommentPost(null)}
          onCommentAdded={refetchPosts}
        />
      )}
    </Screen>
  );
}

function CommentsModal({ post, onClose, onCommentAdded }) {
  const { data: comments = [], isLoading, refetch } = useGetCommentsQuery(post._id);
  const [addComment, { isLoading: isAdding }] = useAddCommentMutation();
  const [commentText, setCommentText] = useState('');

  const handleSend = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment({ postId: post._id, body: commentText.trim() }).unwrap();
      setCommentText('');
      refetch();
      onCommentAdded();
    } catch (e) {
      alert(e?.data?.message || 'Could not post comment');
    }
  };

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.commentSheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border }}>
            <T v="h3">Comments</T>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>

          {/* Comments List */}
          <FlatList
            data={comments}
            keyExtractor={(c) => c._id}
            contentContainerStyle={{ gap: 10, paddingVertical: 10 }}
            ListEmptyComponent={
              <T v="small" style={{ textAlign: 'center', color: colors.muted, marginVertical: 20 }}>
                No comments yet. Start the conversation!
              </T>
            }
            renderItem={({ item: c }) => (
              <View style={styles.commentItem}>
                <Avatar user={c.author} name={c.author?.name} size={32} />
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 12, padding: 8 }}>
                  <T v="strong" style={{ fontSize: 13 }}>{c.author?.name || 'User'}</T>
                  <T v="body" style={{ fontSize: 13, color: colors.ink }}>{c.body}</T>
                </View>
              </View>
            )}
          />

          {/* Comment Composer */}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8 }}>
            <Input
              placeholder="Write a comment..."
              value={commentText}
              onChangeText={setCommentText}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Button
              title="Send"
              small
              disabled={!commentText.trim()}
              loading={isAdding}
              onPress={handleSend}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  commentSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: '75%',
    flex: 1,
  },
  commentItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
});
