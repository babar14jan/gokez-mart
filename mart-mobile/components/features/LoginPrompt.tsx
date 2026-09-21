import { View, Text, TouchableOpacity, Image } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/theme';

interface Props {
  icon: string;
  title: string;
  subtitle: string;
}

export default function LoginPrompt({ icon, title, subtitle }: Props) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgTint }}>
      {/* Blurred teaser rows — fake content behind */}
      <View style={{ padding: 16, gap: 12, opacity: 0.18 }}>
        {[80, 60, 90, 50, 70].map((w, i) => (
          <View key={i} style={{ backgroundColor: colors.gray200, height: 64, borderRadius: 14 }} />
        ))}
      </View>

      {/* Bottom sheet overlay */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 48, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 12 }}>
        {/* Icon */}
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Ionicons name={icon as any} size={30} color={colors.primary} />
        </View>

        <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 8 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
          {subtitle}
        </Text>

        {/* Login CTA */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/login')}
          style={{ width: '100%', height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 }}
        >
          <Ionicons name="call-outline" size={18} color="#fff" />
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>Login with Phone</Text>
        </TouchableOpacity>

        <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray400, textAlign: 'center' }}>
          OTP sent via phone call · No password needed
        </Text>
      </View>
    </View>
  );
}
