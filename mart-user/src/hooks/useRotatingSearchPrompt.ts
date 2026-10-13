import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../services/api';

const ROTATION_MS = 2800;

export function useRotatingSearchPrompt(products: Product[]): string {
  const names = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const product of products) {
      for (const value of [product.name?.trim(), product.localName?.trim()]) {
        if (value && !seen.has(value)) {
          seen.add(value);
          list.push(value);
        }
      }
    }
    return list;
  }, [products]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (names.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex(current => (current + 1) % names.length);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [names]);

  if (!names.length) return 'Search products...';
  return `Search for ${names[index % names.length]}`;
}
