import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { addressApi, authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';

const LABELS = ['Home', 'Work', 'Other'];

function parseStoredAddress(stored: string | null): { house: string; building: string; locality: string; landmark: string; city: string; pincode: string } {
  if (!stored) return { house: '', building: '', locality: '', landmark: '', city: '', pincode: '' };
  const parts = stored.split(',').map(part => part.trim());
  const possiblePincode = parts[parts.length - 1] ?? '';
  const hasPincode = /^\d{6}$/.test(possiblePincode);
  const body = hasPincode ? parts.slice(0, -2) : parts;
  return {
    house: body[0] ?? '',
    building: body[1] ?? '',
    locality: body.slice(2).join(', '),
    landmark: '',
    city: hasPincode ? parts[parts.length - 2] ?? '' : '',
    pincode: hasPincode ? possiblePincode : '',
  };
}

export default function AddressFormScreen() {
  const colors = useThemeColors();
  const { customer, updateProfile } = useAuthStore();
  const {
    id, label: paramLabel, addressLine: paramAddressLine,
    latitude: paramLatitude, longitude: paramLongitude, returnToCheckout,
  } = useLocalSearchParams<{
    id?: string; label?: string; addressLine?: string;
    latitude?: string; longitude?: string; returnToCheckout?: string;
  }>();
  const isEditing = !!id;

  const needsName = !!customer && !customer.name?.trim();

  const initial = parseStoredAddress(paramAddressLine ?? null);
  const [name,     setName]     = useState('');
  const [label,    setLabel]    = useState(paramLabel ?? 'Home');
  const [house,    setHouse]    = useState(initial.house);
  const [building, setBuilding] = useState(initial.building);
  const [locality, setLocality] = useState(initial.locality);
  const [landmark, setLandmark] = useState(initial.landmark);
  const [city,     setCity]     = useState(initial.city);
  const [pincode,  setPincode]  = useState(initial.pincode);
  const [latitude, setLatitude] = useState(paramLatitude ?? '');
  const [longitude, setLongitude] = useState(paramLongitude ?? '');
  const [locating, setLocating] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const canSave = house.trim() && locality.trim() && city.trim() && /^\d{6}$/.test(pincode);

  const clearCoordinates = () => { setLatitude(''); setLongitude(''); };

  const handleLocate = async () => {
    try {
      setLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location permission', 'Allow location access to add coordinates, or enter them manually.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setLatitude(String(position.coords.latitude));
      setLongitude(String(position.coords.longitude));
    } catch {
      Alert.alert('Location unavailable', 'Could not get your location. Enter coordinates manually or leave them blank.');
    } finally { setLocating(false); }
  };

  const handleSave = async () => {
    if (!canSave) { Alert.alert('Complete address', 'Enter house or flat number, locality, city, and a valid 6-digit pincode.'); return; }
    const trimmedName = name.trim().replace(/\s+/g, ' ');
    if (needsName && trimmedName && (trimmedName.length < 2 || trimmedName.length > 80 || !/\p{L}/u.test(trimmedName))) {
      Alert.alert('Enter a valid name', 'Your name should be 2–80 characters and include letters.'); return;
    }
    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const parsedLatitude = hasLatitude ? Number(latitude) : null;
    const parsedLongitude = hasLongitude ? Number(longitude) : null;
    if (hasLatitude !== hasLongitude
      || (parsedLatitude !== null && !Number.isFinite(parsedLatitude))
      || (parsedLongitude !== null && !Number.isFinite(parsedLongitude))
      || (parsedLatitude !== null && (parsedLatitude < -90 || parsedLatitude > 90))
      || (parsedLongitude !== null && (parsedLongitude < -180 || parsedLongitude > 180))) {
      Alert.alert('Invalid coordinates', 'Enter both latitude and longitude with valid values, or leave both blank.');
      return;
    }
    const addressLine = [house.trim(), building.trim(), locality.trim(), landmark.trim(), city.trim(), pincode].filter(Boolean).join(', ');
    setSaving(true);
    try {
      if (isEditing) await addressApi.update(id!, label, addressLine, parsedLatitude, parsedLongitude);
      else await addressApi.add(label, addressLine, undefined, parsedLatitude, parsedLongitude);
      if (needsName && trimmedName) {
        authApi.updateProfile({ name: trimmedName })
          .then(() => updateProfile({ name: trimmedName }))
          .catch(() => {});
      }
      if (returnToCheckout === 'true' && !isEditing) router.replace('/checkout');
      else router.back();
    } catch {
      Alert.alert('Error', 'Failed to save. Try again.');
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

        {needsName && (
          <Field label="Your Name" value={name} onChangeText={setName} placeholder="e.g. Rahul Sharma" autoFocus colors={colors} />
        )}

        <Field label="Flat / House Number" value={house} onChangeText={v => { setHouse(v); clearCoordinates(); }} placeholder="e.g. Flat 204 or House 12" required autoFocus={!isEditing && !needsName} colors={colors} />
        <Field label="Building / Tower" value={building} onChangeText={v => { setBuilding(v); clearCoordinates(); }} placeholder="e.g. Orchid Tower" colors={colors} />
        <Field label="Street / Locality" value={locality} onChangeText={v => { setLocality(v); clearCoordinates(); }} placeholder="e.g. New Town, Action Area" required colors={colors} />
        <Field label="Landmark" value={landmark} onChangeText={v => { setLandmark(v); clearCoordinates(); }} placeholder="Optional, helps your rider" colors={colors} />
        <Field label="City" value={city} onChangeText={v => { setCity(v); clearCoordinates(); }} placeholder="e.g. Kolkata" required colors={colors} />
        <Field label="Pincode" value={pincode} onChangeText={v => { setPincode(v.replace(/\D/g, '').slice(0, 6)); clearCoordinates(); }} placeholder="6-digit pincode" required colors={colors} keyboardType="number-pad" />

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Location coordinates <Text style={{ fontFamily: 'Inter-Regular', textTransform: 'none', letterSpacing: 0 }}>(optional)</Text></Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label="Latitude" value={latitude} onChangeText={setLatitude} placeholder="e.g. 22.5726" colors={colors} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Longitude" value={longitude} onChangeText={setLongitude} placeholder="e.g. 88.3639" colors={colors} keyboardType="decimal-pad" />
            </View>
          </View>
          <TouchableOpacity onPress={handleLocate} disabled={locating}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary }}>
            {locating
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="locate-outline" size={16} color={colors.primary} />}
            <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Use my current location</Text>
          </TouchableOpacity>
        </View>

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
  required?: boolean; colors: ReturnType<typeof useThemeColors>; keyboardType?: 'default' | 'number-pad' | 'decimal-pad'; autoFocus?: boolean;
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
