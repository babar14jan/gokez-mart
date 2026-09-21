import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { addressApi, type Address } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

export default function AddressesScreen() {
  const colors = useThemeColors();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busyId,    setBusyId]    = useState<string | null>(null);

  const load = useCallback(() => {
    addressApi.list().then(r => setAddresses(r.data.data ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSetDefault = async (id: string) => {
    setBusyId(id);
    try { await addressApi.setDefault(id); load(); }
    catch { Alert.alert('Error', 'Failed to set default address.'); }
    finally { setBusyId(null); }
  };

  const handleDelete = (addr: Address) => {
    Alert.alert('Delete Address', `Remove "${addr.label}" address?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusyId(addr.id);
          try { await addressApi.remove(addr.id); load(); }
          catch { Alert.alert('Error', 'Failed to delete address.'); }
          finally { setBusyId(null); }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={addresses}
        keyExtractor={a => a.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Ionicons name="location-outline" size={40} color={colors.gray300} style={{ marginBottom: 10 }} />
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500 }}>No saved addresses yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: item.isDefault ? colors.primaryLight : colors.gray50, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <Ionicons name={item.label.toLowerCase() === 'home' ? 'home-outline' : item.label.toLowerCase() === 'work' ? 'briefcase-outline' : 'location-outline'}
                  size={17} color={item.isDefault ? colors.primary : colors.gray500} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{item.label}</Text>
                  {item.isDefault && (
                    <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 20 }}>
                      <Text style={{ fontSize: 9, fontFamily: 'Inter-Bold', color: colors.primary }}>Default</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 18 }}>{item.addressLine}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {!item.isDefault && (
                <TouchableOpacity onPress={() => handleSetDefault(item.id)} disabled={busyId === item.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.gray200 }}>
                  <Ionicons name="checkmark-circle-outline" size={13} color={colors.gray600} />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray600 }}>Set Default</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => router.push({ pathname: '/address-form', params: { id: item.id, label: item.label, addressLine: item.addressLine } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.gray200 }}>
                <Ionicons name="pencil-outline" size={13} color={colors.gray600} />
                <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray600 }}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item)} disabled={busyId === item.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.gray200 }}>
                <Ionicons name="trash-outline" size={13} color={colors.red500} />
                <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.red500 }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.gray100, padding: 16, paddingBottom: 28 }}>
        <TouchableOpacity onPress={() => router.push('/address-form')}
          style={{ height: 52, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Add New Address</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
