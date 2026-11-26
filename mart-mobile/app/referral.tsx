import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Share, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import {
  referralApi, type ReferralCredit, type ReferralMeData, type ReferralRecord,
} from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';
import { APP_CONFIG } from '@/constants/config';
import {
  availableReferralBalance, buildReferralLink, buildReferralShareMessage,
  buildWhatsAppReferralLink, normalizeReferralCode, redeemableReferralBalance, sortReferralCredits,
} from '@/utils/referral';

function rupees(value: number | string | null | undefined): string {
  const n = Number(value);
  const rounded = Number.isFinite(n) ? n : 0;
  return `₹${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusLabel(value: string | null | undefined): string {
  const clean = String(value ?? '');
  return clean ? clean.charAt(0).toUpperCase() + clean.replace(/_/g, ' ').slice(1) : '—';
}

function expiryLabel(value: string | null | undefined): string {
  return value ? `Expires ${dateLabel(value)}` : 'No expiry';
}

function creditFor(referral: ReferralRecord | undefined, credits: ReferralCredit[], type: string, stage?: number): ReferralCredit | undefined {
  return credits.find(credit => credit.benefitType === type && credit.referralId === referral?.id && (stage === undefined || credit.stageNumber === stage));
}

function historyLabel(referral: ReferralRecord, credits: ReferralCredit[]): string {
  if (referral.status === 'capped') return 'Limit reached';
  if (referral.status === 'expired' || referral.status === 'rejected') return statusLabel(referral.status);
  if (referral.role === 'referee') {
    const first = creditFor(referral, credits, 'first_order');
    const stageOne = creditFor(referral, credits, 'reward', 1);
    if (first?.status === 'redeemed' || stageOne?.status === 'redeemed') return referral.status === 'rewarded' ? 'Reward credited' : 'First benefit used';
    if (first?.status === 'reserved') return 'First order placed';
    if (stageOne?.status === 'available' || stageOne?.status === 'reserved') return 'First-order benefit added';
    return referral.status === 'rewarded' ? 'Reward credited' : 'Waiting for first order delivery';
  }
  if (referral.status === 'rewarded') return 'Delivered · Reward credited';
  return 'Waiting for delivery';
}

export default function ReferralScreen() {
  const colors = useThemeColors();
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const [data, setData] = useState<ReferralMeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const response = await referralApi.getMe();
      setData(response.data.data);
    } catch {
      setLoadError('We could not load your referral rewards. Please try again.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) { setData(null); setLoading(false); return; }
    void refresh();
  }, [isLoggedIn, refresh]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2500);
  };

  const code = normalizeReferralCode(data?.code);
  const link = buildReferralLink(code, APP_CONFIG.webUrl);
  const campaign = data?.campaign;
  const stages = [...(campaign?.rewardStages ?? [])].sort((a, b) => Number(a.stage) - Number(b.stage));
  const totalReward = Number(campaign?.totalRewardAmount) || 0;
  const firstStageAmount = Math.max(0, Number(stages.find(stage => Number(stage.stage) === 1)?.amount) || 0);
  const remainingAmount = stages
    .filter(stage => Number(stage.stage) !== 1)
    .reduce((sum, stage) => sum + Math.max(0, Number(stage.amount) || 0), 0);
  const maxStageAmount = Math.max(0, ...stages.map(stage => Math.max(0, Number(stage.amount) || 0)));
  const redemptionMinimum = Number(data?.redemptionMinimum ?? campaign?.redemptionMinOrderAmount ?? data?.minimumOrderAmount) || 0;
  const expiryDays = Number(campaign?.expiryDays) || 0;
  const credits = sortReferralCredits(data?.credits);
  const referrals = data?.referrals ?? [];
  const stats = data?.stats;
  const shareMessage = buildReferralShareMessage(code, link, stages);

  const copyText = async (value: string, message: string) => {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      showNotice(message);
    } catch {
      showNotice('Could not copy. Please select the text and copy it manually.');
    }
  };

  const handleShare = async () => {
    if (!shareMessage) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(link || shareMessage, { dialogTitle: 'Refer & Earn' });
        return;
      }
      await Share.share({ message: shareMessage, url: link || undefined, title: 'Refer & Earn' });
    } catch {}
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ionicons name="gift-outline" size={30} color={colors.primary} />
          </View>
          <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 8 }}>Refer & Earn</Text>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 24 }}>
            Log in to see your referral code, rewards and invitations.
          </Text>
          <TouchableOpacity
            style={{ height: 52, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>Log in or sign up</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 12 }}>Loading your rewards…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.red500, textAlign: 'center' }}>{loadError}</Text>
          <TouchableOpacity style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary }} onPress={() => void refresh()}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#fff' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {notice ? (
          <View style={{ backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.primaryDark }}>{notice}</Text>
          </View>
        ) : null}

        <View style={{ backgroundColor: colors.primaryLight, borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primaryDark, marginBottom: 6 }}>YOUR REFERRAL CODE</Text>
          <Text style={{ fontSize: 30, fontFamily: 'Inter-Bold', color: colors.gray900, letterSpacing: 4 }}>{code || '—'}</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600, textAlign: 'center', marginTop: 8 }}>
            Share Gokez Mart with friends and both of you earn rewards.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <ActionButton icon="copy-outline" label="Copy code" onPress={() => void copyText(code, 'Code copied')} disabled={!code} />
            <ActionButton icon="link-outline" label="Copy link" onPress={() => void copyText(link, 'Link copied')} disabled={!link} />
            <ActionButton icon="share-outline" label="Share" onPress={() => void handleShare()} disabled={!shareMessage} />
            <ActionButton icon="logo-whatsapp" label="WhatsApp" onPress={() => void Linking.openURL(buildWhatsAppReferralLink(shareMessage))} disabled={!shareMessage} />
          </View>
        </View>

        <Section title="How it works">
          <Bullet text={`Share your code. A friend who enters it at signup gets ${rupees(totalReward)} in referral rewards: ${rupees(firstStageAmount)} for their first order (no referral minimum) and ${rupees(remainingAmount)} on later orders${redemptionMinimum > 0 ? ` with a ${rupees(redemptionMinimum)} product subtotal` : ''}.`} />
          <Bullet text={`After your friend’s first order is delivered, you get ${rupees(totalReward)} in referral rewards.`} />
          {stages.length > 0 ? (
            <Bullet text={`Campaign stages: ${stages.map(stage => `Stage ${Number(stage.stage)} ${rupees(stage.amount)}`).join(' · ')}.`} />
          ) : null}
          <Bullet text={`You can use up to ${rupees(maxStageAmount)} in one order${redemptionMinimum > 0 ? ` on a minimum order of ${rupees(redemptionMinimum)}` : ''}.`} />
          <Bullet text={expiryDays > 0 ? `Credits expire ${expiryDays} days after they unlock.` : 'Credits do not expire.'} />
          <Bullet text="Invite as many friends as you like — sharing your code has no limit; campaign reward limits still apply." />
        </Section>

        <Section title="Your progress">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCard label="Successful referrals" value={String(Number(stats?.successfulReferrals) || 0)} />
            <StatCard label="Pending referrals" value={String(Number(stats?.pendingReferrals) || 0)} />
          </View>
          <Text style={styles.footnote}>
            Successful means the friend’s first order was delivered. Pending means we are waiting for that delivery.
          </Text>
        </Section>

        <Section title="Rewards wallet">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatCard label="Total earned so far" value={rupees(stats?.totalEarned)} />
            <StatCard label="Unlocked total" value={rupees(stats?.available ?? availableReferralBalance(data?.credits))} />
            <StatCard label="Redeemable now" value={rupees(stats?.redeemableNow ?? redeemableReferralBalance(data?.credits))} />
            <StatCard label="Used" value={rupees(stats?.used)} />
            <StatCard label="Pending" value={rupees(stats?.pending)} />
            <StatCard label="Expired" value={rupees(stats?.expired)} />
          </View>
          <Text style={styles.footnote}>
            Total earned includes pending rewards. Unlocked total counts rewards issued and not used yet; Redeemable now is what you can use at checkout today.
          </Text>
        </Section>

        {referrals.some(referral => referral.role === 'referee') ? (
          <Section title="Your referral benefit">
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, padding: 14 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Total reward: {rupees(totalReward)}</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600, marginTop: 6 }}>{rupees(firstStageAmount)} — {firstBenefitStatus(referrals, credits)}</Text>
              {remainingAmount > 0 ? (
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600, marginTop: 4 }}>{rupees(remainingAmount)} — {laterBenefitStatus(referrals, credits, stages[1]?.stage)}</Text>
              ) : null}
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.primaryDark, marginTop: 8 }}>
                Rewards open in stage order. You can use {rupees(stats?.redeemableNow ?? redeemableReferralBalance(data?.credits))} right now; the rest opens after earlier stages. One reward per order — no coupon stacking.
              </Text>
            </View>
          </Section>
        ) : null}

        <Section title="Your credits">
          {credits.length === 0 ? (
            <InfoCard text="No rewards yet. Share your code — your first-order discount and later rewards will appear here." />
          ) : credits.map(credit => (
            <View key={credit.id} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, padding: 14, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>
                {credit.benefitType === 'first_order'
                  ? `First order · ${rupees(credit.amount)} off · No referral minimum`
                  : `${credit.stageNumber ? `Stage ${credit.stageNumber} · ` : ''}${rupees(credit.amount)} reward`}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 4 }}>
                {expiryLabel(credit.expiresAt)}
                {credit.status === 'available' && credit.redeemableNow === false ? ' · Unlocks after earlier stages' : ''}
                {credit.status === 'available' && credit.redeemableNow === true ? ' · Redeemable now' : ''}
              </Text>
              <View style={{ alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: colors.primaryDark }}>{statusLabel(credit.status)}</Text>
              </View>
            </View>
          ))}
        </Section>

        <Section title="Referral history">
          {referrals.length === 0 ? (
            <InfoCard text="No referrals yet." />
          ) : referrals.map(referral => (
            <View key={referral.id} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, padding: 14, marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>
                {referral.role === 'referee' ? 'Used a referral code' : 'Referred a friend'} · {dateLabel(referral.attributedAt)}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 4 }}>{historyLabel(referral, credits)}</Text>
              <View style={{ alignSelf: 'flex-start', backgroundColor: colors.gray100, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: colors.gray600 }}>{statusLabel(referral.status)}</Text>
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function firstBenefitStatus(referrals: ReferralRecord[], credits: ReferralCredit[]): string {
  const referral = referrals.find(item => item.role === 'referee');
  const first = creditFor(referral, credits, 'first_order');
  const stageOne = creditFor(referral, credits, 'reward', 1);
  if (first?.status === 'reserved') return 'Applied to your first order';
  if (first?.status === 'redeemed') return 'Used on your first order';
  if (first?.status === 'expired') return 'Expired before use';
  if (stageOne?.status === 'redeemed') return 'Stage 1 used';
  if (stageOne?.status === 'available') return 'Stage 1 reward ready';
  return 'Ready for your first order — no referral minimum';
}

function laterBenefitStatus(referrals: ReferralRecord[], credits: ReferralCredit[], stage?: number): string {
  const referral = referrals.find(item => item.role === 'referee');
  const credit = creditFor(referral, credits, 'reward', stage);
  if (credit?.status === 'redeemed') return 'Used on a later order';
  if (credit?.status === 'reserved') return 'Applied to your next order';
  if (credit?.status === 'expired') return 'Expired before use';
  if (credit?.status === 'available') return 'Ready for your next order';
  return 'Opens after your first order is delivered';
}

const styles = {
  footnote: { fontSize: 11, fontFamily: 'Inter-Regular', color: '#6b7280', lineHeight: 16, marginTop: 8 } as const,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>•</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 17 }}>{text}</Text>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexGrow: 1, flexBasis: '44%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, padding: 12 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{label}</Text>
      <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 4 }}>{value}</Text>
    </View>
  );
}

function InfoCard({ text }: { text: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, padding: 14 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{text}</Text>
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.gray200, opacity: disabled ? 0.5 : 1 }}
    >
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray800 }}>{label}</Text>
    </TouchableOpacity>
  );
}
