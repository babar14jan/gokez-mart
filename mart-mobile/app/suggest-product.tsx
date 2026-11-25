import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, suggestionApi } from '@/services/api';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeColors } from '@/constants/theme';
import { track } from '@/utils/track';

export default function SuggestProductScreen() {
  const colors = useThemeColors();
  const selectedZone = useZoneStore(s => s.selectedZone);

  const [storeName, setStoreName] = useState<string | null>(null);
  const [product, setProduct] = useState('');
  const [detail, setDetail] = useState('');
  const [consent, setConsent] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!selectedZone?.storeId) { setStoreName(null); return; }
    storeApi.getSettings(selectedZone.storeId, selectedZone.id)
      .then(r => setStoreName(r.data.data?.store_name ?? null))
      .catch(() => setStoreName(null));
  }, [selectedZone?.id, selectedZone?.storeId]);

  const submit = async () => {
    const suggestedProduct = product.trim().slice(0, 200);
    if (!suggestedProduct) { setError('Please tell us what you would like us to stock.'); return; }
    setLoading(true); setError('');
    try {
      await suggestionApi.submit({
        suggestedProduct,
        detail: detail.trim() || undefined,
        zoneId: selectedZone?.id ?? null,
        zoneName: selectedZone?.name ?? null,
        storeId: selectedZone?.storeId ?? null,
        storeName: storeName ?? null,
        contactConsent: consent,
      });
      try { track('suggest_product_submitted'); } catch {}
      setProduct(''); setDetail(''); setConsent(true); setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not send your suggestion. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {done ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Ionicons name="sparkles-outline" size={28} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 8 }}>Thanks for the suggestion!</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 24 }}>
                We share every request with our team. If we add it, you may see it in the catalog soon.
              </Text>
              <TouchableOpacity
                style={{ height: 48, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => setDone(false)}
              >
                <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: '#fff' }}>Suggest another</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 22, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>Suggest a product</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 24 }}>
                Tell us what you would like us to stock.
              </Text>

              <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.gray700, marginBottom: 6 }}>Product name</Text>
              <TextInput
                style={{ height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900, paddingHorizontal: 14, fontFamily: 'Inter-Regular', fontSize: 14 }}
                placeholder="e.g. Amul butter, Maggi, Dettol soap"
                placeholderTextColor={colors.gray400}
                value={product}
                maxLength={200}
                onChangeText={value => { setProduct(value); setError(''); }}
                autoFocus
              />
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, textAlign: 'right', marginTop: 4 }}>{product.length}/200</Text>

              <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.gray700, marginTop: 16, marginBottom: 6 }}>Any details? (optional)</Text>
              <TextInput
                style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter-Regular', fontSize: 14, minHeight: 80, textAlignVertical: 'top' }}
                placeholder="Brand, size, or anything else that helps…"
                placeholderTextColor={colors.gray400}
                value={detail}
                maxLength={500}
                multiline
                numberOfLines={3}
                onChangeText={setDetail}
              />

              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 }} onPress={() => setConsent(value => !value)} activeOpacity={0.7}>
                <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Contact me if this product is added.</Text>
              </TouchableOpacity>

              {selectedZone ? (
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 16 }}>
                  Sharing with {selectedZone.name}
                  {storeName && storeName !== selectedZone.name ? ` · ${storeName}` : ''}
                </Text>
              ) : null}

              {error ? (
                <View style={{ backgroundColor: colors.redLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={{ height: 52, borderRadius: 14, backgroundColor: product.trim() && !loading ? colors.primary : colors.gray200, alignItems: 'center', justifyContent: 'center', marginTop: 24 }}
                onPress={submit}
                disabled={loading || !product.trim()}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Submit</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
