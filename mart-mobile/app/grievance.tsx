import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { authApi, type Grievance } from '@/services/api';
import { colors as staticColors, useThemeColors } from '@/constants/theme';

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  open:        { bg: '#fef3c7', fg: '#b45309' },
  in_progress: { bg: '#dbeafe', fg: '#1d4ed8' },
  resolved:    { bg: staticColors.primaryLight, fg: staticColors.primaryDark },
  closed:      { bg: staticColors.gray100, fg: staticColors.gray500 },
};

export default function GrievanceScreen() {
  const colors = useThemeColors();
  const [subject,     setSubject]     = useState('');
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [error,       setError]       = useState('');
  const [grievances,  setGrievances]  = useState<Grievance[]>([]);
  const [loading,     setLoading]     = useState(true);

  const loadGrievances = () => authApi.getGrievances().then(r => setGrievances(r.data.data ?? [])).catch(() => {});

  useEffect(() => { loadGrievances().finally(() => setLoading(false)); }, []);

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true); setError('');
    try {
      await authApi.submitGrievance(subject.trim(), description.trim());
      setSubmitted(true); setSubject(''); setDescription('');
      await loadGrievances();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Submit form */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16, marginBottom: 20 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 18, marginBottom: 14 }}>
            Under the DPDP Act 2023, you have the right to raise a grievance about how your data is handled. We will respond within 30 days.
          </Text>

          {submitted && (
            <View style={{ backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primaryDark }}>✓ Grievance submitted successfully.</Text>
            </View>
          )}
          {error ? (
            <View style={{ backgroundColor: '#fef2f2', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
            </View>
          ) : null}

          <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Subject *</Text>
          <TextInput
            style={{ backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, marginBottom: 14 }}
            value={subject} onChangeText={setSubject}
            placeholder="e.g. Wrong item delivered" placeholderTextColor={colors.gray400}
          />

          <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Description *</Text>
          <TextInput
            style={{ backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, minHeight: 90, textAlignVertical: 'top', marginBottom: 16 }}
            value={description} onChangeText={setDescription}
            placeholder="Describe your concern in detail..." placeholderTextColor={colors.gray400}
            multiline
          />

          <TouchableOpacity onPress={handleSubmit} disabled={submitting || !subject.trim() || !description.trim()}
            style={{ height: 50, borderRadius: 14, backgroundColor: (submitting || !subject.trim() || !description.trim()) ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Submit Grievance</Text>}
          </TouchableOpacity>
        </View>

        {/* Past grievances */}
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : grievances.length > 0 && (
          <>
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Past Grievances</Text>
            {grievances.map(g => {
              const s = STATUS_STYLE[g.status] ?? STATUS_STYLE.closed;
              return (
                <View key={g.id} style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 14, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{g.subject}</Text>
                    <View style={{ backgroundColor: s.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
                      <Text style={{ fontSize: 9, fontFamily: 'Inter-Bold', color: s.fg, textTransform: 'capitalize' }}>{g.status.replace(/_/g, ' ')}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 8 }}>{g.description}</Text>
                  {g.response && (
                    <View style={{ backgroundColor: colors.primaryLight, borderRadius: 10, padding: 10, marginBottom: 6 }}>
                      <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: colors.primaryDark, marginBottom: 2 }}>Our Response</Text>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{g.response}</Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
                    {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
