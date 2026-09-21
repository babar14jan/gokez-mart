import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { addressApi } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const LABELS = ['Home', 'Work', 'Other'];

export default function AddressFormScreen() {
  const colors = useThemeColors();
  const { id, label: paramLabel, addressLine: paramAddressLine } = useLocalSearchParams<{ id?: string; label?: string; addressLine?: string }>();
  const isEditing = !!id;

  const [label,       setLabel]       = useState(paramLabel ?? 'Home');
  const [addressLine, setAddressLine] = useState(paramAddressLine ?? '');
  const [saving,      setSaving]      = useState(false);

  const handleSave = async () => {
    if (!addressLine.trim()) { Alert.alert('Required', 'Please enter the full address.'); return; }
    setSaving(true);
    try {
      if (isEditing) await addressApi.update(id!, label, addressLine.trim());
      else await addressApi.add(label, addressLine.trim());
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to save address. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Label</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
          {LABELS.map(l => {
            const active = label === l;
            return (
              <TouchableOpacity key={l} onPress={() => setLabel(l)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: active ? colors.primary : colors.gray200, backgroundColor: active ? colors.primaryLight : colors.surface }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: active ? colors.primary : colors.gray600 }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Full Address</Text>
        <TextInput
          style={{ backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter-Regular', color: colors.gray900, minHeight: 110, textAlignVertical: 'top', marginBottom: 20 }}
          value={addressLine} onChangeText={setAddressLine}
          placeholder="Flat / House No., Street, Area, City, Pincode" placeholderTextColor={colors.gray400}
          multiline autoFocus={!isEditing}
        />

        <TouchableOpacity onPress={handleSave} disabled={saving || !addressLine.trim()}
          style={{ height: 54, borderRadius: 16, backgroundColor: saving || !addressLine.trim() ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>{isEditing ? 'Save Changes' : 'Save Address'}</Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
