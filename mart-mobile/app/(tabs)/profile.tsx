import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Image,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { authApi, addressApi, type Address } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';
import LoginPrompt from '@/components/features/LoginPrompt';

export default function ProfileScreen() {
  const colors = useThemeColors();
  const { customer, updateProfile, logout, isLoggedIn } = useAuthStore();

  const [editingName,      setEditingName]      = useState(false);
  const [nameVal,          setNameVal]          = useState(customer?.name ?? '');
  const [savingName,       setSavingName]       = useState(false);
  const [uploadingPhoto,   setUploadingPhoto]   = useState(false);
  const [defaultAddress,   setDefaultAddress]   = useState<Address | null>(null);
  const [exportLoading,    setExportLoading]    = useState(false);
  const [exportDone,       setExportDone]       = useState(false);

  const initial = customer?.name
    ? customer.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : (customer?.phone ?? '?')[0].toUpperCase();

  useEffect(() => {
    if (!isLoggedIn) return;
    addressApi.list().then(r => setDefaultAddress(r.data.data?.find(a => a.isDefault) ?? r.data.data?.[0] ?? null)).catch(() => {});
  }, [isLoggedIn]);

  const saveName = async () => {
    if (!nameVal.trim()) return;
    setSavingName(true);
    try {
      await authApi.updateProfile({ name: nameVal.trim() });
      updateProfile({ name: nameVal.trim() });
      setEditingName(false);
    } catch { Alert.alert('Error', 'Failed to save name. Try again.'); }
    finally { setSavingName(false); }
  };

  const handlePickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access to update your profile picture.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    setUploadingPhoto(true);
    try {
      const res = await authApi.uploadPhoto(result.assets[0].uri);
      updateProfile({ photoUrl: res.data.data.url });
    } catch { Alert.alert('Error', 'Failed to upload photo. Try again.'); }
    finally { setUploadingPhoto(false); }
  };

  const handleDataExport = async () => {
    setExportLoading(true);
    try {
      await authApi.requestDataExport();
      Alert.alert('Data Export', 'Your data export has been requested. We\'ll email it to you within 24 hours.');
      setExportDone(true);
    } catch { Alert.alert('Error', 'Failed to request data export. Try again.'); }
    finally { setExportLoading(false); }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await authApi.requestDeletion('user_request');
              Alert.alert('Request Submitted', 'Your account deletion request has been submitted. We\'ll process it within 7 days.');
            } catch { Alert.alert('Error', 'Failed to submit request. Try again.'); }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => { await logout(); } },
    ]);
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <LoginPrompt
          icon="person-outline"
          title="Your profile"
          subtitle="Login to manage your addresses, view orders and personalise your experience."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* ── Profile header ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginHorizontal: 16, marginTop: 20, paddingBottom: 20 }}>
          {/* Large avatar */}
          <TouchableOpacity onPress={handlePickPhoto} disabled={uploadingPhoto}
            style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {uploadingPhoto ? (
              <ActivityIndicator color={colors.primary} />
            ) : customer?.photoUrl ? (
              <Image source={{ uri: customer.photoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <Text style={{ fontSize: 26, fontFamily: 'Inter-Bold', color: colors.primary }}>{initial}</Text>
            )}
            <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface }}>
              <Ionicons name="camera" size={10} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            {editingName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput
                  style={{ flex: 1, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={nameVal} onChangeText={setNameVal}
                  placeholder="Your full name" placeholderTextColor={colors.gray400}
                  autoFocus returnKeyType="done" onSubmitEditing={saveName}
                />
                <TouchableOpacity onPress={saveName} disabled={savingName}
                  style={{ backgroundColor: colors.primary, padding: 9, borderRadius: 10 }}>
                  {savingName ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingName(false); setNameVal(customer?.name ?? ''); }}>
                  <Ionicons name="close" size={20} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, flex: 1 }} numberOfLines={1}>
                  {customer?.name ?? <Text style={{ fontFamily: 'Inter-Regular', fontSize: 16, color: colors.gray400 }}>Add name</Text>}
                </Text>
                <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
                  <Ionicons name="pencil-outline" size={13} color={colors.gray500} />
                </View>
              </TouchableOpacity>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500 }}>+91 {customer?.phone}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#dcfce7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 }}>
                <Ionicons name="checkmark-circle" size={11} color="#16a34a" />
                <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: '#16a34a' }}>Verified</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Delivery Address ── */}
        <SectionLabel label="Delivery Address" />
        <Card>
          <TouchableOpacity onPress={() => router.push('/addresses')}
            style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {defaultAddress
                ? (
                  <>
                    <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{defaultAddress.label}</Text>
                    <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 19, marginTop: 2 }} numberOfLines={2}>{defaultAddress.addressLine}</Text>
                  </>
                )
                : <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray400, fontStyle: 'italic' }}>No address saved — tap to add</Text>
              }
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.primary, marginTop: 4 }}>Manage addresses</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.gray300} style={{ marginTop: 2 }} />
          </TouchableOpacity>
        </Card>

        {/* ── Settings ── */}
        <SectionLabel label="Settings" />
        <Card>
          <LinkRow icon="notifications-outline" iconColor="#8b5cf6"
            label="Notifications" sub="Order updates & promotional alerts" onPress={() => router.push('/notification-settings')} />
        </Card>

        {/* ── Contact ── */}
        <SectionLabel label="Contact Gokez" />
        <Card>
          <LinkRow icon="mail-outline" iconColor="#3b82f6" label="Email Support" sub="support@gokez.com"
            onPress={() => Linking.openURL('mailto:support@gokez.com')} />
          <Divider />
          <LinkRow icon="logo-whatsapp" iconColor="#22c55e" label="WhatsApp Support" sub="Chat with us on WhatsApp"
            onPress={() => Linking.openURL('https://wa.me/918777376280?text=Hi%2C%20I%20need%20help%20with%20Gokez%20Mart.')} />
        </Card>

        {/* ── Feedback ── */}
        <TouchableOpacity
          style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: colors.surface, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.gray100 }}
          onPress={() => router.push('/feedback')}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#fef9c3', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18 }}>⭐</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Share Feedback</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Rate your experience with Gokez Mart</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray300} />
        </TouchableOpacity>

        {/* ── Data & Privacy ── */}
        <SectionLabel label="Data & Privacy" />
        <Card>
          <LinkRow icon="chatbubble-ellipses-outline" iconColor="#8b5cf6"
            label="Submit a Grievance" sub="Complaint about your data or service" onPress={() => router.push('/grievance')} />
          <Divider />
          <LinkRow icon="download-outline" iconColor={colors.primary}
            label={exportDone ? 'Export Requested ✓' : 'Download My Data'}
            sub="Export your profile, orders & history"
            onPress={handleDataExport}
            loading={exportLoading} />
          <Divider />
          <LinkRow icon="document-text-outline" iconColor={colors.gray500} label="Privacy Policy" sub="" onPress={() => router.push('/privacy')} />
          <Divider />
          <LinkRow icon="reader-outline" iconColor={colors.gray500} label="Terms of Service" sub="" onPress={() => router.push('/terms')} />
        </Card>

        {/* ── Sign out + Delete ── */}
        <View style={{ alignItems: 'center', marginTop: 16, gap: 8 }}>
          <TouchableOpacity onPress={handleLogout} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Medium', color: colors.red500 }}>Sign Out</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteAccount} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray400 }}>Delete my account</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={{ alignItems: 'center', marginTop: 16, gap: 4 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
            A product of{' '}
            <Text style={{ fontFamily: 'Inter-Bold', color: colors.primary }}>Gokez Technologies Pvt. Ltd.</Text>
          </Text>
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
            © {new Date().getFullYear()}
          </Text>
          <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray300 }}>
            Version {Constants.expoConfig?.version ?? '1.0.0'}
          </Text>
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  const colors = useThemeColors();
  return (
    <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginTop: 20, marginBottom: 6 }}>
      {label}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
      {children}
    </View>
  );
}

function Divider() {
  const colors = useThemeColors();
  return <View style={{ height: 1, backgroundColor: colors.gray100, marginLeft: 58 }} />;
}

function AddressRow({ label, value, isDefault = false, onEdit }: { label: string; value?: string | null; isDefault?: boolean; onEdit: () => void }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: isDefault ? colors.primaryLight : colors.gray50, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 }}>
        <Ionicons name="location-outline" size={16} color={isDefault ? colors.primary : colors.gray500} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>{label}</Text>
          {isDefault && (
            <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 20 }}>
              <Text style={{ fontSize: 9, fontFamily: 'Inter-Bold', color: colors.primary }}>Default</Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: value ? colors.gray700 : colors.gray400, fontStyle: value ? 'normal' : 'italic', lineHeight: 18 }}>
          {value ?? 'Tap Edit to add'}
        </Text>
      </View>
      <TouchableOpacity onPress={onEdit}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.gray200, flexShrink: 0 }}>
        <Ionicons name="pencil" size={11} color={colors.gray500} />
        <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

function LinkRow({ icon, iconColor, label, sub, onPress, loading = false }: { icon: any; iconColor: string; label: string; sub: string; onPress: () => void; loading?: boolean }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity onPress={onPress} disabled={loading}
      style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: iconColor + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {loading ? <ActivityIndicator size="small" color={iconColor} /> : <Ionicons name={icon} size={17} color={iconColor} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Medium', color: colors.gray800 }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.gray300} />
    </TouchableOpacity>
  );
}
