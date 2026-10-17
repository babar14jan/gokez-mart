import { useRef, useEffect, useState, useCallback } from 'react';
import { View, FlatList, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import type { CarouselCard } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const WEB_BASE = 'https://mart.gokez.com';
const SCREEN_W = Dimensions.get('window').width;

const CARD_W   = Math.round(SCREEN_W * 0.78);   // active card — side cards peek in
const CARD_H   = Math.round(CARD_W * (9 / 16));
const GAP      = 12;
const SNAP     = CARD_W + GAP;
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;

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

interface ItemProps {
  item: CarouselCard;
  index: number;
  scrollX: Animated.SharedValue<number>;
  fallbackColor: string;
}

function CarouselItem({ item, index, scrollX, fallbackColor }: ItemProps) {
  const imgUrl  = resolveUrl(item.image_url);
  const bgColor = GRADIENT_COLORS[item.gradient?.split(' ')[0]] ?? fallbackColor;
  const center  = index * SNAP;

  const rStyle = useAnimatedStyle(() => {
    const inputRange = [center - SNAP, center, center + SNAP];
    const scale   = interpolate(scrollX.value, inputRange, [0.9, 1, 0.9], Extrapolation.CLAMP);
    const opacity = interpolate(scrollX.value, inputRange, [0.55, 1, 0.55], Extrapolation.CLAMP);
    return { transform: [{ scale }], opacity };
  });

  return (
    <Animated.View
      style={[
        { width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden', marginRight: GAP },
        rStyle,
      ]}
    >
      {imgUrl ? (
        <Image source={{ uri: imgUrl }} style={{ width: CARD_W, height: CARD_H }} contentFit="cover" transition={300} />
      ) : (
        <View style={{ width: CARD_W, height: CARD_H, backgroundColor: bgColor }} />
      )}
    </Animated.View>
  );
}

export default function HomeCarousel({ cards }: Props) {
  const colors   = useThemeColors();
  const ref      = useRef<FlatList<CarouselCard>>(null);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollX  = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: e => { scrollX.value = e.contentOffset.x; },
  });

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    if (cards.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex(prev => {
        const next = (prev + 1) % cards.length;
        ref.current?.scrollToOffset({ offset: next * SNAP, animated: true });
        return next;
      });
    }, 4000);
  }, [cards.length, stopTimer]);

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, [startTimer, stopTimer]);

  if (cards.length === 0) return null;

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <Animated.FlatList
        ref={ref}
        data={cards}
        keyExtractor={c => c.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToOffsets={cards.map((_, i) => i * SNAP)}
        snapToEnd={false}
        snapToAlignment="start"
        disableIntervalMomentum
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ paddingHorizontal: SIDE_PAD }}
        getItemLayout={(_, i) => ({ length: SNAP, offset: SIDE_PAD + SNAP * i, index: i })}
        onScrollBeginDrag={stopTimer}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / SNAP);
          setIndex(Math.max(0, Math.min(i, cards.length - 1)));
          startTimer();
        }}
        renderItem={({ item, index: i }) => (
          <CarouselItem item={item} index={i} scrollX={scrollX} fallbackColor={colors.primary} />
        )}
      />

      {cards.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, gap: 6 }}>
          {cards.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === index ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? colors.primary : colors.gray200,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
