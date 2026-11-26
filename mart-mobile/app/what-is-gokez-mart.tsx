import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/constants/theme';

const BRAND_NAME = 'Gokez Mart';
const BRAND_SLOGAN = 'Shop Local. Support Local.';
const BRAND_DESCRIPTION = 'Gokez Mart is an online marketplace for ordering everyday essentials from nearby stores.';
const BRAND_PROMISE = "We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they've built in your community over years.";
const PARENT_COMPANY = 'Gokez Technologies';
const PARENT_COMPANY_URL = 'https://gokez.com/';

export default function WhatIsGokezMartScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{BRAND_SLOGAN}</Text>
        <Text style={{ fontSize: 26, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 16 }}>What is {BRAND_NAME}?</Text>

        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>{BRAND_DESCRIPTION}</Text>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>{BRAND_PROMISE}</Text>
        </View>

        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 24, marginBottom: 8 }}>How it works</Text>
        <View style={{ gap: 8 }}>
          {[
            'Choose your delivery area to see the stores that serve it.',
            'Browse everyday essentials and add what you need to your cart.',
            'Check out and pay online or on delivery, and track your order to the door.',
          ].map((step, index) => (
            <View key={step} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>{index + 1}.</Text>
              <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>{step}</Text>
            </View>
          ))}
        </View>

        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 24, marginBottom: 8 }}>What you can order</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>
          Fresh produce, groceries, household and personal-care items, and other daily essentials from local stores. What is available depends on the stores and delivery areas currently served.
        </Text>

        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 24, marginBottom: 8 }}>Who runs {BRAND_NAME}</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 21 }}>
          {BRAND_NAME} is a product of{' '}
          <Text style={{ fontFamily: 'Inter-SemiBold', color: colors.primary }} onPress={() => void Linking.openURL(PARENT_COMPANY_URL)}>{PARENT_COMPANY}</Text>
          , the company building focused technology products for everyday life in India.
        </Text>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 28 }}>
          <TouchableOpacity
            style={{ flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/about' as any)}
          >
            <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray800 }}>About {BRAND_NAME}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Start shopping</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
