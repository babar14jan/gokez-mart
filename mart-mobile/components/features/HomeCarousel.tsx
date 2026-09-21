import { useRef, useEffect, useState } from 'react';
import { View, FlatList, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import type { CarouselCard } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const WEB_BASE  = 'https://mart.gokez.com';
const SCREEN_W  = Dimensions.get('window').width;
const CARD_W    = SCREEN_W - 32;   // 16px margin each side
const CARD_H    = Math.round(CARD_W * (9 / 16));

function resolveUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${WEB_BASE}${url}`;
}

const GRADIENT_COLORS: Record<string, string> = {
  'from-emerald-500': '#10b981',
  'from-violet-500':  '#8b5cf6',
  'from-rose-500':    '#f43f5e',
  'from-amber-500':   '#f59e0b',
};

interface Props { cards: CarouselCard[] }

export default function HomeCarousel({ cards }: Props) {
  const colors  = useThemeColors();
  const ref      = useRef<FlatList>(null);
  const [index,  setIndex]  = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (cards.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex(prev => {
        const next = (prev + 1) % cards.length;
        ref.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
  };

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [cards.length]);

  if (cards.length === 0) return null;

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <FlatList
        ref={ref}
        data={cards}
        keyExtractor={c => c.id}
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + 12}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        getItemLayout={(_, i) => ({ length: CARD_W + 12, offset: (CARD_W + 12) * i, index: i })}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
          setIndex(i);
          startTimer();
        }}
        renderItem={({ item }) => {
          const imgUrl  = resolveUrl(item.image_url);
          const bgColor = GRADIENT_COLORS[item.gradient?.split(' ')[0]] ?? colors.primary;
          return (
            <View style={{ width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden' }}>
              {imgUrl ? (
                <Image source={{ uri: imgUrl }} style={{ width: CARD_W, height: CARD_H }} contentFit="cover" transition={300} />
              ) : (
                <View style={{ width: CARD_W, height: CARD_H, backgroundColor: bgColor }} />
              )}
            </View>
          );
        }}
      />

      {/* Dots */}
      {cards.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, gap: 6 }}>
          {cards.map((_, i) => (
            <View key={i} style={{ width: i === index ? 20 : 6, height: 6, borderRadius: 3, backgroundColor: i === index ? colors.primary : colors.gray200 }} />
          ))}
        </View>
      )}
    </View>
  );
}
