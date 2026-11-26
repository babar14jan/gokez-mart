import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';

const BRAND_NAME = 'Gokez Mart';
const BRAND_SLOGAN = 'Shop Local. Support Local.';
const BRAND_DESCRIPTION = 'Gokez Mart is an online marketplace for ordering everyday essentials from nearby stores.';
const BRAND_PROMISE = "We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they've built in your community over years.";
const PARENT_COMPANY = 'Gokez Technologies';
const PARENT_COMPANY_URL = 'https://gokez.com/';

export default function AboutScreen() {
  const colors = useThemeColors();
  const isDark = useThemeStore(s => s.isDark);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.gray200, padding: 20, alignItems: 'center' }}>
          <Image
            source={isDark ? require('../assets/brand_dark.png') : require('../assets/brand_light.png')}
            style={{ width: 160, height: 48 }}
            contentFit="contain"
          />
          <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.primary, marginTop: 8 }}>{BRAND_SLOGAN}</Text>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, lineHeight: 21, textAlign: 'center', marginTop: 16 }}>{BRAND_DESCRIPTION}</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 20, textAlign: 'center', marginTop: 12 }}>{BRAND_PROMISE}</Text>
        </View>

        <View style={{ marginTop: 20, gap: 16 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>
            {BRAND_NAME} is a product of{' '}
            <Text
              style={{ fontFamily: 'Inter-SemiBold', color: colors.primary }}
              onPress={() => void Linking.openURL(PARENT_COMPANY_URL)}
            >
              {PARENT_COMPANY}
            </Text>
            , the company building focused technology products for everyday life in India.
          </Text>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>
            Availability depends on the stores and delivery areas currently served by {BRAND_NAME}.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
          {['Shop Local', 'Support Local', 'Everyday Essentials', 'Doorstep Delivery'].map(label => (
            <View key={label} style={{ flex: 1, backgroundColor: colors.primaryLight, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center' }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-SemiBold', color: colors.primaryDark, textAlign: 'center' }}>{label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={{ marginTop: 28, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => void Linking.openURL(PARENT_COMPANY_URL)}
        >
          <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Visit {PARENT_COMPANY}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
