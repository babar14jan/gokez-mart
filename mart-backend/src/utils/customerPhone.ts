export function normalizeCustomerPhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function isValidCustomerPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}