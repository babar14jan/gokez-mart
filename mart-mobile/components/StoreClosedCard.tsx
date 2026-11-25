import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/theme';
import { defaultClosedHeading, formatClosedMessage, reopenBlockLine } from '@/utils/storeClosed';

interface Props {
  open: boolean;
  onClose: () => void;
  greeting?: string | null;
  message?: string | null;
  resumeLabel?: string | null;
  primaryLabel?: string;
}

export default function StoreClosedCard({
  open,
  onClose,
  greeting,
  message,
  resumeLabel,
  primaryLabel = 'Got it',
}: Props) {
  const colors = useThemeColors();
  const heading = greeting?.trim() || defaultClosedHeading();
  const authored = message?.trim() || '';
  const text = authored ? formatClosedMessage(authored, { until: resumeLabel || 'later' }) : '';

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: 24, padding: 24, paddingTop: 32 }}>
          <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 12, right: 12, padding: 4 }}>
            <Ionicons name="close" size={20} color={colors.gray500} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', lineHeight: 22 }}>
            {heading}
          </Text>
          {text ? (
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray600, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
              {text}
            </Text>
          ) : null}
          {resumeLabel ? (
            <View style={{ marginTop: 18, borderRadius: 16, padding: 14, backgroundColor: '#fef3c7', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="time-outline" size={16} color="#92400e" />
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#78350f' }}>Reopens {resumeLabel}</Text>
              </View>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#92400e', textAlign: 'center', marginTop: 6 }}>
                {reopenBlockLine(resumeLabel)}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            style={{ marginTop: 20, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
