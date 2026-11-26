import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[mart] unhandled render error', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.red500} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            This screen hit an error. Your cart is saved — try again to pick up where you left off.
          </Text>
          <TouchableOpacity onPress={this.retry} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 8 },
  message: { fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  button: { height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  buttonText: { fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' },
});
