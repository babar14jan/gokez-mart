import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { addressApi } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const LABELS = ['Home', 'Work', 'Other'];

export default function AddressFormScreen() {
  const colors = useThemeColors();
  const { id, label: paramLabel, addressLine: paramAddressLine, returnToCheckout } = useLocalSearchParams<{ id?: string; label?: string; addressLine?: string; returnToCheckout?: string }>();
  const isEditing = !!id;

  const [label,    setLabel]    = useState(paramLabel ?? 'Home');
  const [house,    setHouse]    = useState('');
  const [building, setBuilding] = useState('');
  const [locality, setLocality] = useState(paramAddressLine ?? '');
  const [landmark, setLandmark] = useState('');
  const [city,     setCity]     = useState('');
  const [pincode,  setPincode]  = useState('');
  const [saving,   setSaving]   = useState(false);

  const canSave = house.trim() && locality.trim() && city.trim() && /^\d{6}$/.test(pincode);

  const handleSave = async () => {
    if (!canSave) { Alert.alert('Complete address', 'Enter house or flat number, locality, city, and a valid 6-digit pincode.'); return; }
    const addressLine = [house.trim(), building.trim(), locality.trim(), landmark.trim(), city.trim(), pincode].filter(Boolean).join(', ');
    setSaving(true);
    try {
      if (isEditing) await addressApi.update(id!, label, addressLine);
      else await addressApi.add(label, addressLine);
      if (returnToCheckout === 'true' && !isEditing) router.replace('/checkout');
      else router.back();
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

        <Field label="Flat / House Number" value={house} onChangeText={setHouse} placeholder="e.g. Flat 204 or House 12" required autoFocus={!isEditing} colors={colors} />
        <Field label="Building / Tower" value={building} onChangeText={setBuilding} placeholder="e.g. Orchid Tower" colors={colors} />
        <Field label="Street / Locality" value={locality} onChangeText={setLocality} placeholder="e.g. New Town, Action Area" required colors={colors} />
        <Field label="Landmark" value={landmark} onChangeText={setLandmark} placeholder="Optional, helps your rider" colors={colors} />
        <Field label="City" value={city} onChangeText={setCity} placeholder="e.g. Kolkata" required colors={colors} />
        <Field label="Pincode" value={pincode} onChangeText={value => setPincode(value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit pincode" required colors={colors} keyboardType="number-pad" />

        <TouchableOpacity onPress={handleSave} disabled={saving || !canSave}
          style={{ height: 54, borderRadius: 16, backgroundColor: saving || !canSave ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
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

function Field({ label, value, onChangeText, placeholder, required = false, colors, keyboardType, autoFocus = false }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder: string;
  required?: boolean; colors: ReturnType<typeof useThemeColors>; keyboardType?: 'default' | 'number-pad'; autoFocus?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {label}{required ? ' *' : ''}
      </Text>
      <TextInput
        style={{ backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 15, fontFamily: 'Inter-Regular', color: colors.gray900 }}
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.gray400}
        keyboardType={keyboardType} autoFocus={autoFocus}
      />
    </View>
  );
}
