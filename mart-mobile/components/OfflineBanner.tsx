import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/theme';

export default function OfflineBanner({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await NetInfo.fetch();
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    } catch {
      setOffline(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = NetInfo.addEventListener(state => {
      if (mounted) setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    void refresh();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') void refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
      subscription.remove();
    };
  }, [refresh]);

  const retry = async () => {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  };

  return (
    <View style={styles.container}>
      {children}
      {offline && (
        <SafeAreaView edges={['top']} style={[styles.banner, { backgroundColor: colors.gray900 }]}>
          <View style={styles.content}>
            <Ionicons name="wifi-outline" size={19} color="#fff" />
            <View style={styles.copy}>
              <Text style={styles.title}>No internet connection</Text>
              <Text style={styles.subtitle}>Check your connection, then tap Retry.</Text>
            </View>
            <TouchableOpacity onPress={retry} disabled={retrying} style={styles.retry}>
              <Text style={[styles.retryText, retrying && styles.retryTextDisabled]}>
                {retrying ? 'Checking…' : 'Retry'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  copy: { flex: 1 },
  title: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' },
  subtitle: { fontSize: 11, fontFamily: 'Inter-Regular', color: '#d1d5db', marginTop: 1 },
  retry: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.16)' },
  retryText: { fontSize: 12, fontFamily: 'Inter-Bold', color: '#fff' },
  retryTextDisabled: { opacity: 0.6 },
});
