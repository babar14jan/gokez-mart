export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.mart.gokez.com/api/v1';

export const APP_CONFIG = {
  name:        'Gokez Mart',
  supportEmail: 'support@gokez.com',
  whatsapp:    '919000000000',
  webUrl:      'https://mart.gokez.com',
} as const;

export { ORDER_STATUS_LABELS } from '@/utils/orderStatus';
