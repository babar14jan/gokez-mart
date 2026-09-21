import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { feedbackApi } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const CATEGORIES = [
  { value: 'delivery',        label: '🛵 Delivery',        desc: 'Speed, rider, packaging' },
  { value: 'product_quality', label: '📦 Product Quality', desc: 'Freshness, accuracy' },
  { value: 'pricing',         label: '💰 Pricing',         desc: 'Value for money' },
  { value: 'store_service',   label: '🏪 Store Service',   desc: 'Staff, responsiveness' },
  { value: 'app_experience',  label: '📱 App Experience',  desc: 'Ease of use, bugs' },
  { value: 'suggestion',      label: '💡 Suggestion',      desc: 'Ideas to improve' },
  { value: 'other',           label: '💬 Other',           desc: 'Anything else' },
];

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

export default function FeedbackScreen() {
  const colors = useThemeColors();
  const [rating,     setRating]     = useState(0);
  const [category,   setCategory]   = useState('');
  const [message,    setMessage]    = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState('');

  const handleSubmit = async () => {
    if (!rating || !category) return;
    setSubmitting(true); setError('');
    try {
      await feedbackApi.submit({ rating, category, message: message.trim() || undefined });
      setDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 8 }}>Thank you!</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 28 }}>
          Your feedback helps us improve Gokez Mart for everyone.
        </Text>
        <TouchableOpacity onPress={() => router.back()}
          style={{ height: 50, paddingHorizontal: 32, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter-Bold' }}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Star rating */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 20, alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 2 }}>How was your experience?</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 14 }}>Tap a star to rate</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <TouchableOpacity key={i} onPress={() => setRating(i)} activeOpacity={0.7}>
                <Ionicons name={i <= rating ? 'star' : 'star-outline'} size={34} color={i <= rating ? '#f59e0b' : colors.gray200} />
              </TouchableOpacity>
            ))}
          </View>
          {rating > 0 && <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#f59e0b' }}>{STAR_LABELS[rating]}</Text>}
        </View>

        {/* Category */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16, marginBottom: 14 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 10 }}>What's your feedback about?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIES.map(cat => {
              const active = category === cat.value;
              return (
                <TouchableOpacity key={cat.value} onPress={() => setCategory(cat.value)}
                  style={{
                    width: '48%', padding: 12, borderRadius: 12, borderWidth: 1.5,
                    borderColor: active ? colors.primary : colors.gray100,
                    backgroundColor: active ? colors.primaryLight : colors.surface,
                  }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{cat.label}</Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{cat.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Message */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16, marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 8 }}>
            Tell us more <Text style={{ fontFamily: 'Inter-Regular', color: colors.gray500, fontSize: 12 }}>(optional)</Text>
          </Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50, minHeight: 80, textAlignVertical: 'top' }}
            value={message} onChangeText={setMessage}
            placeholder="Share your experience in detail..." placeholderTextColor={colors.gray400}
            multiline
          />
        </View>

        {error ? <Text style={{ fontSize: 12, color: colors.red500, textAlign: 'center', marginBottom: 12, fontFamily: 'Inter-Regular' }}>{error}</Text> : null}

        <TouchableOpacity onPress={handleSubmit} disabled={!rating || !category || submitting}
          style={{ height: 54, borderRadius: 16, backgroundColor: (!rating || !category || submitting) ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Submit Feedback</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
