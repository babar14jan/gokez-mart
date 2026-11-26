import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';

function isValidName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 80 && /\p{L}/u.test(name);
}

export default function SetupProfileScreen() {
  const colors = useThemeColors();
  const { updateProfile } = useAuthStore();
  const [name, setName]       = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!isValidName(name)) { Alert.alert('Enter a valid name using at least 2 characters.'); return; }
    if (!address.trim()) { Alert.alert('Please enter your delivery address'); return; }
    const normalized = name.trim().replace(/\s+/g, ' ');
    setLoading(true);
    try {
      await authApi.updateProfile({ name: normalized, address: address.trim() });
      updateProfile({ name: normalized, address: address.trim() });
      router.replace('/(tabs)');
    } catch {
      Alert.alert('Failed to save profile. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingTop: 80, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold mb-1" style={{ fontFamily: 'Inter-Bold', color: colors.gray900 }}>
          Almost there.
        </Text>
        <Text className="text-sm mb-8" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
          Tell us your name and where to deliver
        </Text>

        <Text className="text-sm font-medium mb-1" style={{ fontFamily: 'Inter-Medium', color: colors.gray700 }}>Your full name *</Text>
        <TextInput
          className="rounded-xl px-4 h-14 text-base mb-4"
          style={{ fontFamily: 'Inter-Regular', borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
          placeholder="Your full name *"
          placeholderTextColor={colors.gray400}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          autoFocus
        />

        <Text className="text-sm font-medium mb-1" style={{ fontFamily: 'Inter-Medium', color: colors.gray700 }}>Delivery address</Text>
        <TextInput
          className="rounded-xl px-4 py-3 text-base"
          style={{ fontFamily: 'Inter-Regular', minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
          placeholder="Flat no., building, street, area..."
          placeholderTextColor={colors.gray400}
          value={address}
          onChangeText={setAddress}
          multiline
          numberOfLines={3}
        />

        <TouchableOpacity
          className="mt-6 h-14 rounded-xl items-center justify-center"
          style={{ backgroundColor: isValidName(name) && address.trim() && !loading ? colors.primary : colors.gray200 }}
          onPress={handleSave}
          disabled={loading || !isValidName(name) || !address.trim()}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text className="text-white text-base font-semibold" style={{ fontFamily: 'Inter-SemiBold' }}>Start Shopping</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
