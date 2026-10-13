import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../services/api';

const ROTATION_MS = 2800;
const PRODUCT_COUNT = 3;
const MAX_PROMPT_LENGTH = 36;

export function useRotatingSearchPrompt(products: Product[]): string {
  const names = useMemo(() => products
    .map(product => product.name.trim() || product.localName?.trim() || '')
    .filter((name, index, all) => name && all.indexOf(name) === index), [products]);
  const [startIndex, setStartIndex] = useState(0);

  useEffect(() => {
    setStartIndex(0);
    if (names.length <= PRODUCT_COUNT) return;
    const timer = window.setInterval(() => {
      setStartIndex(index => (index + PRODUCT_COUNT) % names.length);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [names]);

  if (!names.length) return 'Search products...';
  const prefix = 'Search for ';
  const visibleNames: string[] = [];
  for (let offset = 0; offset < Math.min(PRODUCT_COUNT, names.length); offset += 1) {
    const name = names[(startIndex + offset) % names.length];
    const nextPrompt = `${prefix}${[...visibleNames, name].join(', ')}`;
    if (visibleNames.length > 0 && nextPrompt.length > MAX_PROMPT_LENGTH) break;
    visibleNames.push(name);
  }
  return `${prefix}${visibleNames.join(', ')}`;
}