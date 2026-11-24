import axios, { type AxiosRequestConfig } from 'axios';
import { api } from './api';

type Envelope<T> = { success: boolean; data: T };

export interface Paged<T> {
  items: T[];
  total: number;
}

export type ReferralStatus =
  | 'pending'
  | 'qualified'
  | 'rewarded'
  | 'capped'
  | 'rejected'
  | 'expired';

export type ReferralReportType = 'conversion' | 'orders' | 'customers' | 'liability';
export type ReferralExportType = 'records' | 'ledger';
export type CampaignAction = 'activate' | 'pause';

export interface ReferralRewardStage {
  stage: number;
  amount: number;
}

export interface ReferralSummary {
  referrals: number;
  rewarded: number;
  pending: number;
  capped: number;
  rejected: number;
  expired: number;
  qualifyingValue: number;
  rewardsIssued: number;
  liability: number;
  redeemed: number;
  credits: number;
  liabilityByRole?: Array<{ role: string; liability: number; redeemed: number }>;
  liabilityByStage?: Array<{ role: string; stage: number; liability: number; redeemed: number }>;
}

export interface ReferralCampaign {
  id: string;
  name: string;
  status: string;
  version: number;
  total_reward_amount: number | string | null;
  reward_stages: ReferralRewardStage[] | null;
  redemption_min_order_amount: number | string | null;
  expiry_days: number | string | null;
  max_referrals_per_referrer: number | string | null;
  stacking_enabled: boolean;
  unlock_trigger: string;
  cash_withdrawal: boolean;
  transfer_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  budget: number | string | null;
  code_length: number | string;
  fraud_review_enabled: boolean;
  value_basis: string;
  category_ids: string[] | null;
  reason?: string | null;
  createdByName?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ReferralCampaignForm {
  name: string;
  totalRewardAmount: string;
  stageAmounts: string[];
  redemptionMinOrderAmount: string;
  expiryDays: string;
  maxReferralsPerReferrer: string;
  stackingEnabled: boolean;
  unlockTrigger: string;
  cashWithdrawal: boolean;
  transferEnabled: boolean;
  startsAt: string;
  endsAt: string;
  budget: string;
  fraudReviewEnabled: boolean;
  valueBasis: string;
  reason: string;
}

export interface ReferralAuditEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorAdminId: string | null;
  actorCustomerId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface ReferralCampaignHistoryEntry {
  id: string;
  entityId: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface ReferralRecord {
  id: string;
  status: ReferralStatus | string;
  attributionSource: string | null;
  attributedAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  qualifyingOrderValue: number | null;
  qualifyingOrderId: string | null;
  notes: string | null;
  code: string | null;
  referredName: string | null;
  referredPhone: string | null;
  referrerName: string | null;
  referrerPhone: string | null;
  creditAmount: number;
  pendingAmount: number;
  unlockedAmount: number;
  campaignName: string | null;
  campaignVersion: number | string | null;
}

export interface ReferralRecordDetail {
  id: string;
  status: string;
  attribution_source: string | null;
  attributed_at: string | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  rejected_at?: string | null;
  qualifying_order_id: string | null;
  qualifying_order_value: number | string | null;
  notes: string | null;
  code: string | null;
  campaignName: string | null;
  campaignVersion: number | string | null;
  referrer_customer_id: string | null;
  referred_customer_id: string | null;
  rewards: Array<{ id: string; role: string; amount: number; status: string }>;
  credits: Array<{ id: string; amount: number; status: string; orderId: string | null }>;
  ledger: Array<{ id: string; reference: string; type: string; amount: number; reason: string | null; createdAt: string }>;
  [key: string]: unknown;
}

export interface ReferralCustomer {
  id: string;
  phone: string;
  name: string | null;
  code: string | null;
  successfulReferrals: number;
  rewardedReferrals: number;
  availableCredits: number;
  totalEarned: number;
  pendingAmount: number;
  unlockedAmount: number;
  redeemedAmount: number;
}

export interface ReferralLedgerEntry {
  id: string;
  reference: string;
  type: string;
  amount: number;
  balanceAfter: number;
  customerId: string | null;
  creditId: string | null;
  rewardId: string | null;
  referralId: string | null;
  orderId: string | null;
  reason: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

export interface ReferralFraudEntry {
  id: string;
  status: string;
  notes: string | null;
  attributedAt: string | null;
  rewardedAt: string | null;
  code: string | null;
  referredPhone: string | null;
  referrerPhone: string | null;
  riskSignals?: string[] | Record<string, unknown> | null;
  risk_signals?: string[] | Record<string, unknown> | null;
  signals?: string[] | Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ConversionReportRow {
  status: string;
  count: number;
  delivered: number;
}

export interface OrdersReportRow {
  day: string;
  orders: number;
  value: number;
}

export interface CustomersReportRow {
  customerId: string;
  name: string | null;
  phone: string | null;
  referrals: number;
  rewarded: number;
  earnedAmount: number;
  pendingAmount: number;
  unlockedAmount: number;
}

export interface LiabilityReportRow {
  customerId: string;
  status: string;
  credits: number;
  amount: number;
}

export type ReferralReportRow = ConversionReportRow | OrdersReportRow | CustomersReportRow | LiabilityReportRow;

export interface ReferralRecordFilters {
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  customerId?: string;
  referrerId?: string;
  limit?: number;
  offset?: number;
}

export interface ReferralLedgerFilters {
  customerId?: string;
  type?: string;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ReferralFraudFilters {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ReferralAuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  customerId?: string;
  limit?: number;
  offset?: number;
}

const request = <T>(method: 'get' | 'post' | 'put', url: string, config?: AxiosRequestConfig): Promise<T> => {
  if (method === 'post') return api.post<Envelope<T>>(url, config?.data, config).then(r => r.data.data);
  if (method === 'put') return api.put<Envelope<T>>(url, config?.data, config).then(r => r.data.data);
  return api.get<Envelope<T>>(url, config).then(r => r.data.data);
};

// Every read here drives a balance, queue or review list, so skip the hub's
// 20s auth-blind GET cache by default. Callers may still opt into a cached read.
const list = <T>(url: string, params?: object) =>
  request<T>('get', url, { params, fresh: true });

const mutate = <T>(method: 'post' | 'put', url: string, data?: unknown) =>
  request<T>(method, url, { data });

export const referralAdminApi = {
  getCampaigns: (filters: { status?: string; query?: string; limit?: number; offset?: number } = {}) =>
    list<Paged<ReferralCampaign>>('/admin/referral/campaigns', filters),
  createCampaign: (data: Record<string, unknown>) =>
    mutate<ReferralCampaign>('post', '/admin/referral/campaigns', data),
  updateCampaign: (id: string, data: Record<string, unknown>) =>
    mutate<ReferralCampaign>('put', `/admin/referral/campaigns/${id}`, data),
  campaignAction: (id: string, action: CampaignAction) =>
    mutate<ReferralCampaign>('post', `/admin/referral/campaigns/${id}/${action}`),
  getCampaignHistory: (filters: { campaignId?: string; limit?: number; offset?: number } = {}) =>
    list<Paged<ReferralCampaignHistoryEntry>>('/admin/referral/campaigns/history', filters),

  getRecords: (filters: ReferralRecordFilters = {}) => {
    const { search, ...rest } = filters;
    return list<Paged<ReferralRecord>>('/admin/referral/records', {
      ...rest,
      ...(search ? { query: search } : {}),
    });
  },
  getRecord: (id: string) =>
    list<ReferralRecordDetail>(`/admin/referral/records/${id}`),

  getCustomers: (query: string, limit = 50, offset = 0, customerId?: string, filter?: string) =>
    list<Paged<ReferralCustomer>>('/admin/referral/customers', {
      query, limit, offset, customerId,
      filter: filter && filter !== 'all' ? filter : undefined,
    }),
  getLedger: (filters: ReferralLedgerFilters = {}) =>
    list<Paged<ReferralLedgerEntry>>('/admin/referral/ledger', filters),

  getFraud: (filters: ReferralFraudFilters = {}) =>
    list<Paged<ReferralFraudEntry>>('/admin/referral/fraud', filters),
  reviewFraud: (id: string, status: string, notes: string) =>
    mutate<Record<string, unknown>>('put', `/admin/referral/fraud/${id}`, { status, notes }),

  getSummary: (filters: { from?: string; to?: string } = {}) =>
    list<ReferralSummary>('/admin/referral/summary', filters),
  getReport: (type: ReferralReportType, filters: { from?: string; to?: string } = {}) =>
    list<Paged<ReferralReportRow>>(`/admin/referral/reports/${type}`, filters),

  adjust: (customerId: string, amount: number, reason: string) =>
    mutate<{ customerId: string; amount: number; balanceAfter: number }>('post', '/admin/referral/adjustments', { customerId, amount, reason }),
  getAudit: (filters: ReferralAuditFilters = {}) =>
    list<Paged<ReferralAuditEntry>>('/admin/referral/audit', filters),
};

export function getExportUrl(type: ReferralExportType, filters: Record<string, string | number | boolean | null | undefined> = {}): string {
  const base = (api.defaults.baseURL || '').replace(/\/$/, '');
  const search = new URLSearchParams({ type });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return `${base}/admin/referral/export?${search}`;
}

/** Authenticated direct download of the backend's CSV export endpoint. */
export async function downloadReferralCsv(type: ReferralExportType, filters: Record<string, string | number | boolean | null | undefined> = {}): Promise<void> {
  const response = await api.get<Blob>(getExportUrl(type, filters), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `referral-${type}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toCents = (value: unknown): number => Math.round(num(value) * 100);
const fromCents = (cents: number): string => String(Math.round(cents) / 100);

const splitCents = (cents: number, count: number): number[] => {
  if (count <= 0) return [];
  const base = Math.floor(Math.max(0, cents) / count);
  const remainder = Math.max(0, cents) - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

export const stageCents = (amounts: string[]): number[] => amounts.map(toCents);

export const stageTotal = (amounts: string[]): number =>
  stageCents(amounts).reduce((total, cents) => total + cents, 0) / 100;

export const stagesMatchTotal = (amounts: string[], total: unknown): boolean => {
  const cents = stageCents(amounts);
  return cents.length > 0 && cents.every(amount => amount > 0)
    && cents.reduce((sum, amount) => sum + amount, 0) === toCents(total);
};

export const rebalanceStageAmounts = (amounts: string[], total: unknown): string[] => {
  const cents = stageCents(amounts);
  if (!cents.length) return splitCents(toCents(total), 1).map(fromCents);
  const delta = toCents(total) - cents.reduce((sum, amount) => sum + amount, 0);
  const last = cents.length - 1;
  if (delta >= 0 || cents[last] + delta > 0) {
    const next = [...cents];
    next[last] += delta;
    return next.map(fromCents);
  }
  return splitCents(toCents(total), cents.length).map(fromCents);
};

export const changeStageCount = (amounts: string[], total: unknown, count: number): string[] => {
  const nextCount = Math.max(1, Math.min(10, Math.floor(num(count)) || 1));
  const cents = stageCents(amounts);
  if (nextCount === cents.length) return cents.map(fromCents);
  const totalCents = toCents(total);
  if (nextCount > cents.length) {
    const added = nextCount - cents.length;
    const remaining = totalCents - cents.reduce((sum, amount) => sum + amount, 0);
    if (remaining >= added) return [...cents, ...splitCents(remaining, added)].map(fromCents);
  } else {
    const kept = cents.slice(0, nextCount);
    const removed = cents.slice(nextCount).reduce((sum, amount) => sum + amount, 0);
    kept[0] += removed;
    return kept.map(fromCents);
  }
  return splitCents(totalCents, nextCount).map(fromCents);
};

export const campaignToForm = (campaign: ReferralCampaign | null | undefined): ReferralCampaignForm => {
  const configuredStages = Array.isArray(campaign?.reward_stages) ? campaign.reward_stages : [];
  return {
    name: campaign?.name || '',
    totalRewardAmount: campaign && campaign.total_reward_amount !== null && campaign.total_reward_amount !== undefined
      ? String(num(campaign.total_reward_amount)) : '',
    stageAmounts: configuredStages.map(stage => String(num(stage.amount))),
    redemptionMinOrderAmount: campaign?.redemption_min_order_amount === null
      || campaign?.redemption_min_order_amount === undefined || campaign?.redemption_min_order_amount === ''
      ? '' : String(campaign.redemption_min_order_amount),
    expiryDays: campaign?.expiry_days === null || campaign?.expiry_days === undefined || campaign?.expiry_days === ''
      ? '' : String(campaign.expiry_days),
    maxReferralsPerReferrer: campaign ? String(num(campaign.max_referrals_per_referrer)) : '10',
    stackingEnabled: Boolean(campaign?.stacking_enabled),
    unlockTrigger: campaign?.unlock_trigger || 'delivered',
    cashWithdrawal: Boolean(campaign?.cash_withdrawal),
    transferEnabled: Boolean(campaign?.transfer_enabled),
    startsAt: campaign?.starts_at ? String(campaign.starts_at).slice(0, 16) : '',
    endsAt: campaign?.ends_at ? String(campaign.ends_at).slice(0, 16) : '',
    budget: campaign?.budget === null || campaign?.budget === undefined || campaign?.budget === ''
      ? '' : String(campaign.budget),
    fraudReviewEnabled: Boolean(campaign?.fraud_review_enabled),
    valueBasis: campaign?.value_basis || 'item_subtotal',
    reason: '',
  };
};

export const campaignFormToPayload = (form: ReferralCampaignForm): Record<string, unknown> => ({
  name: form.name.trim(),
  totalRewardAmount: num(form.totalRewardAmount),
  rewardStages: form.stageAmounts.map((amount, index) => ({ stage: index + 1, amount: num(amount) })),
  redemptionMinOrderAmount: form.redemptionMinOrderAmount === '' ? null : num(form.redemptionMinOrderAmount),
  expiryDays: form.expiryDays === '' ? null : num(form.expiryDays),
  maxReferralsPerReferrer: num(form.maxReferralsPerReferrer),
  stackingEnabled: form.stackingEnabled,
  unlockTrigger: form.unlockTrigger,
  cashWithdrawal: form.cashWithdrawal,
  transferEnabled: form.transferEnabled,
  startsAt: form.startsAt || null,
  endsAt: form.endsAt || null,
  budget: form.budget === '' ? null : num(form.budget),
  codeLength: 6,
  fraudReviewEnabled: form.fraudReviewEnabled,
  valueBasis: form.valueBasis,
  ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
});

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  const e = error as { response?: { data?: { error?: string } }; message?: string } | null;
  return e?.response?.data?.error || e?.message || fallback;
};

export const isAxiosLikeError = (error: unknown): boolean => axios.isAxiosError(error);
