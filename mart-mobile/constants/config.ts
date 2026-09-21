export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.mart.gokez.com/api/v1';

export const APP_CONFIG = {
  name:        'Gokez Mart',
  supportEmail: 'support@gokez.com',
  whatsapp:    '919000000000',
  webUrl:      'https://mart.gokez.com',
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending:          'Order Placed',
  confirmed:        'Confirmed',
  preparing:        'Being Prepared',
  ready_to_pickup:  'Being Prepared',
  out_for_delivery: 'Being Prepared',
  picked_up:        'On the Way 🛵',
  delivered:        'Delivered 🎉',
  cancelled:        'Cancelled',
};
