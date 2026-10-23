// Prisma Decimal columns (money, units) arrive as strings in JSON.
export type Money = string | number;

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'VENDOR' | 'LANDLORD' | 'CUSTOMER' | 'LANDLORD_STAFF' | 'TENANT';
export type AccountStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED';
export type VendorType = 'INDIVIDUAL' | 'COMPANY';
export type MeterStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
export type RecordStatus = 'ACTIVE' | 'INACTIVE';
export type PropertyType = 'APARTMENT' | 'ESTATE' | 'COMMERCIAL' | 'MIXED_USE' | 'HOSTEL' | 'OTHER';
export type UnitPaymentMethod = 'MPESA_PAYBILL' | 'MPESA_TILL' | 'BANK';
export type UnitOccupancy = 'VACANT' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE';
export type PaymentChannel = 'STK' | 'C2B' | 'NCBA';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';
export type TokenType = 'CREDIT' | 'CLEAR_TAMPER' | 'CLEAR_CREDIT' | 'SET_MAX_OVERDRAFT';
export type VendMode = 'UNIT' | 'VALUE';
export type TransactionStatus = 'SUCCESS' | 'FAILED';
export type EnquiryStatus = 'PENDING' | 'REVIEWED' | 'ARCHIVED';
export type MpesaEnv = 'SANDBOX' | 'LIVE';
export type MpesaTransactionType = 'CUSTOMER_PAYBILL_ONLINE' | 'CUSTOMER_BUYGOODS_ONLINE';
export type ConfigValueType = 'STRING' | 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'JSON';

export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  VENDOR: 'Vendor',
  LANDLORD: 'Landlord',
  CUSTOMER: 'Customer',
  LANDLORD_STAFF: 'Landlord staff',
  TENANT: 'Tenant',
};

export const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  CREDIT: 'Credit',
  CLEAR_TAMPER: 'Clear tamper',
  CLEAR_CREDIT: 'Clear credit',
  SET_MAX_OVERDRAFT: 'Max overdraft',
};

/** The signed-in account as returned by login (same shape for every role). */
export interface User {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  role: Role;
  vendorType: VendorType | null;
}

export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T, M = PaginatedMeta> {
  data: T[];
  meta: M;
}

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string | null;
  status: AccountStatus;
}

export interface DashboardSettings {
  primaryColor?: string | null;
  tagline?: string | null;
  showLogoInSidebar?: boolean | null;
}

export interface Vendor {
  id: string;
  userId: string;
  businessName: string;
  address: string | null;
  accountId: string;
  paybill: string | null;
  vendorType: VendorType;
  bankName: string | null;
  status: AccountStatus;
  logoPath: string | null;
  logoUrl: string | null;
  dashboardSettings: DashboardSettings | null;
  createdAt: string;
  user: UserSummary;
  _count: { meters: number; customers: number };
}

export interface Landlord {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  paymentAccount: string;
  status: AccountStatus;
  createdAt: string;
  user: UserSummary;
  _count: { meters: number; properties: number };
}

export interface Operator {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  role: Role;
  status: AccountStatus;
  createdAt: string;
}

/** GET /auth/me for admins, vendors and landlords. */
export interface StaffProfile {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  role: Role;
  status: AccountStatus;
  bio: string | null;
  profileImage: string | null;
  vendorType: VendorType | null;
  vendor: { id: string; businessName: string; vendorType: VendorType; accountId: string; status: AccountStatus } | null;
  landlord: { id: string; fullName: string; phone: string; paymentAccount: string; status: AccountStatus } | null;
}

/** GET /auth/me for customers. */
export interface CustomerProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
  role: 'CUSTOMER';
  meter: { id: string; meterNumber: string; type: string; pricePerUnit: Money; status: MeterStatus } | null;
  vendor: { id: string; businessName: string; logoPath: string | null } | null;
  county: string | null;
  totalSpent: Money;
  recentTransactions: TransactionSummary[];
}

// ── Meters & customers ───────────────────────────────────────────────────────

export interface Meter {
  id: string;
  meterNumber: string;
  type: string;
  initialReading: Money;
  pricePerUnit: Money;
  status: MeterStatus;
  sgc: number | null;
  krn: number | null;
  ti: number | null;
  ea: number | null;
  ken: number | null;
  vendorId: string | null;
  landlordId: string | null;
  vendor: { id: string; businessName: string } | null;
  landlord: { id: string; fullName: string } | null;
  createdAt: string;
  _count?: { customers: number };
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  status: RecordStatus;
  vendorId: string | null;
  meterId: string | null;
  countyId: number | null;
  constituencyId: number | null;
  wardId: number | null;
  vendor: { id: string; businessName: string } | null;
  meter: { id: string; meterNumber: string; type: string; status: MeterStatus } | null;
  county: { id: number; name: string } | null;
  constituency: { id: number; name: string } | null;
  ward: { id: number; name: string } | null;
  createdAt: string;
}

export interface LocationOption {
  id: number;
  name: string;
}

// ── Tokens & payments ────────────────────────────────────────────────────────

export interface TransactionSummary {
  id: string;
  status: TransactionStatus;
  tokenType: TokenType;
  amount: Money | null;
  units: Money | null;
  tokens: string[];
  description: string | null;
  createdAt: string;
}

export interface TokenTransaction extends TransactionSummary {
  vendMode: VendMode | null;
  phone: string | null;
  sendSms: boolean;
  smsSent: boolean;
  externalTransactionId: string | null;
  meterNumberSnapshot: string | null;
  meter: { id: string; meterNumber: string } | null;
  vendor: { id: string; businessName: string } | null;
  landlord: { id: string; fullName: string } | null;
  customer: { id: string; name: string; phone: string } | null;
  actorUser: { id: string; name: string } | null;
  payment: { id: string; channel: PaymentChannel; mpesaReceiptNumber: string | null } | null;
}

export interface TransactionsMeta extends PaginatedMeta {
  totalAmount: Money;
}

export interface MeterLookup {
  id: string;
  meterNumber: string;
  type: string;
  pricePerUnit: Money;
  status: MeterStatus;
  vendor: { id: string; name: string } | null;
  landlord: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string; address: string | null } | null;
  location: { property: string | null; unit: string | null; address: string | null };
}

export interface VendResult {
  transaction: TokenTransaction;
  tokens: string[];
  smsSent: boolean;
}

export interface Payment {
  id: string;
  channel: PaymentChannel;
  status: PaymentStatus;
  checkoutRequestId: string | null;
  accountReference: string | null;
  phone: string;
  amount: Money;
  mpesaReceiptNumber: string | null;
  resultDesc: string | null;
  payerName: string | null;
  createdAt: string;
  tokenTransactions: { id: string; status: TransactionStatus; tokens: string[] }[];
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string | null;
  customerMessage: string;
}

export interface PaymentStatusResult {
  status: PaymentStatus;
  amount?: Money;
  mpesaReceipt?: string | null;
  accountReference?: string | null;
  failureReason?: string;
  tokens?: string[];
  vendError?: string | null;
  /** Whether the token SMS reached the gateway (present with tokens). */
  smsSent?: boolean;
  /** Rent / deposit prompts: what it paid, and whether it is on the lease statement yet. */
  purpose?: RentClaimPurpose | null;
  posted?: boolean;
  message?: string;
}

export interface PublicTokenResult {
  id: string;
  status: TransactionStatus;
  tokenType: TokenType;
  amount: Money | null;
  units: Money | null;
  tokens: string[];
  description: string | null;
  createdAt: string;
  meter: { id: string; meterNumber: string; type: string } | null;
}

// ── Properties ───────────────────────────────────────────────────────────────

export interface Property {
  id: string;
  ownerName: string;
  name: string;
  propertyType: PropertyType;
  noOfUnits: number;
  location: string;
  status: RecordStatus;
  createdAt: string;
  locationId?: string | null;
  locationGroup?: { id: string; name: string } | null;
  countyId: number | null;
  constituencyId: number | null;
  wardId: number | null;
  county?: LocationOption | null;
  constituency?: LocationOption | null;
  ward?: LocationOption | null;
  _count?: { units: number; tenants: number; leases?: number };
}

/** Where a unit's tenant pays rent. A paybill with no `account` uses the lease code as the account no. */
export interface UnitPaymentAccount {
  method: UnitPaymentMethod;
  number: string;
  account?: string | null;
  bank?: string | null;
  accountName?: string | null;
  /** Configured account the unit uses, e.g. "landlord:paybill"; its number is kept in sync. */
  source?: string | null;
  sourceLabel?: string | null;
  scope?: 'LANDLORD' | 'GLOBAL' | null;
  /** The account is no longer configured (or was typed in by hand before). */
  stale?: boolean;
}

/** A payment account configured in the system that units can use. */
export interface PaymentSource {
  key: string;
  scope: 'LANDLORD' | 'GLOBAL';
  label: string;
  method: UnitPaymentMethod;
  number: string;
  origin: string;
}

/** What a unit saves: which configured account, plus the paybill account reference. */
export interface UnitPaymentInput {
  source: string;
  account?: string | null;
  accountName?: string | null;
}

export interface PropertyUnit {
  id: string;
  name: string;
  unitNumber: string | null;
  status: RecordStatus;
  meterId: string | null;
  meterNumber: string | null;
  monthlyRent: number | null;
  depositAmount: number | null;
  payment: UnitPaymentAccount | null;
  activeLease: { id: string; code: string; tenantId: string; tenantName: string; tenantPhone: string } | null;
  occupancy: UnitOccupancy;
  occupancyNote: string | null;
  tenants: PersonRef[];
  customers: PersonRef[];
}

export interface PersonRef {
  id: string;
  name: string;
  phone: string;
}

/** A token-buying customer who belongs to a landlord (linked to a unit, they buy for its meter). */
export interface LandlordCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: RecordStatus;
  createdAt: string;
  unitId: string | null;
  meterId: string | null;
  unit: { id: string; name: string; property: { id: string; name: string } } | null;
  meter: { meterNumber: string } | null;
  /** May sign in to the customer portal. */
  portalAccess: boolean;
  portalInvitedAt: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  idNumber?: string | null;
  status: RecordStatus;
  unitId: string | null;
  propertyId: string;
  createdAt?: string;
  /** May sign in to the tenant portal. */
  portalAccess?: boolean;
  portalInvitedAt?: string | null;
  /** Present on the landlord's tenant directory. */
  propertyName?: string;
  unitName?: string | null;
  activeLease?: { id: string; code: string } | null;
}

export interface PropertyDetail {
  property: Property;
  units: PropertyUnit[];
  paymentSources: PaymentSource[];
  tenants: Tenant[];
  assignedMeters: { id: string; meterNumber: string; status: MeterStatus }[];
}

// ── Dashboards ───────────────────────────────────────────────────────────────

export interface AdminStats {
  vendors: { total: number; active: number; pending: number; suspended: number };
  landlords: number;
  meters: { total: number; active: number; inactive: number; maintenance: number };
  customers: number;
  pendingEnquiries: number;
  vending: { revenue: number; todayRevenue: number; todayCount: number; tokensIssued: number; failedLast30Days: number };
  dailySales: { date: string; amount: number; count: number; failed: number }[];
  topVendors: { vendorId: string; name: string; amount: number; count: number }[];
  recentTransactions: {
    id: string;
    status: TransactionStatus;
    tokenType: TokenType;
    amount: Money | null;
    createdAt: string;
    meterNumberSnapshot: string | null;
    vendor: { businessName: string } | null;
    landlord: { fullName: string } | null;
  }[];
}

export interface VendorProfileResponse {
  vendor: Vendor;
  stats: { totalMeters: number; activeMeters: number; totalCustomers: number; totalSales: Money; salesCount: number };
}

export interface VendorOversight {
  vendor: Vendor;
  metersCount: number;
  customersCount: number;
  totalSales: Money;
  salesCount: number;
  meters: Meter[];
  customers: (Customer & { meter: { meterNumber: string } | null })[];
}

export interface LandlordDashboard {
  landlord: Landlord;
  summary: { properties: number; units: number; occupied: number; vacant: number; tenants: number; meters: number };
  sales: { total: Money; count: number };
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SystemConfig {
  key: string;
  value: string | null;
  type: ConfigValueType;
  category: string;
  description: string | null;
  isEncrypted: boolean;
  isMasked: boolean;
  updatedAt: string;
}

export interface VendingSetting {
  key: string;
  value: string | null;
  type: ConfigValueType;
  description: string | null;
  isActive: boolean;
}

export interface MpesaConfig {
  id: string;
  consumerKeySet: boolean;
  consumerSecretSet: boolean;
  passkeySet: boolean;
  shortcode: string | null;
  tillNo: string | null;
  env: MpesaEnv;
  callbackUrl: string | null;
  transactionType: MpesaTransactionType;
  updatedAt: string;
}

export interface SmsConfig {
  id: string;
  provider: string | null;
  apiUrl: string | null;
  apiKeySet: boolean;
  partnerId: string | null;
  shortcode: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface PaymentEntity {
  id: string;
  type: 'vendor' | 'landlord';
  name: string;
  subtitle: string;
  status: AccountStatus;
  hasMpesaConfig: boolean;
  mpesaEnv: MpesaEnv | null;
  mpesaShortcode: string | null;
}

export interface Enquiry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  premisesType: string;
  residenceType: string;
  meterTypes: string[];
  mainMeterType: string;
  message: string;
  status: EnquiryStatus;
  createdAt: string;
}

// ── Audit Logs ───────────────────────────────────────────────────────────────

export const AUDIT_ACTION_OPTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'APPROVE', 'REJECT', 'VEND', 'PASSWORD_RESET',
].map((value) => ({ value, label: value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

export const AUDIT_SUBJECT_OPTIONS = [
  'USER', 'VENDOR', 'LANDLORD', 'METER', 'CUSTOMER', 'PROPERTY', 'HIERARCHY', 'TENANT', 'TOKEN', 'PAYMENT',
  'SYSTEM_CONFIG', 'VENDING_SETTING', 'MPESA_CONFIG', 'SMS_CONFIG', 'ENQUIRY',
].map((value) => ({ value, label: value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

export interface AuditLog {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string;
  summary?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  createdAt: string;
  userId: string | null;
  user: { id: string; name: string; email: string; role: Role } | null;
}

// ── Rent management (landlord organization) ─────────────────────────────────

export type OrgRole = 'OWNER' | 'MANAGER' | 'CARETAKER' | 'ACCOUNTANT' | 'VIEWER';
export type StaffRole = Exclude<OrgRole, 'OWNER'>;
export type LandlordPermission =
  | 'properties.view' | 'properties.manage' | 'locations.manage'
  | 'tenants.view' | 'tenants.manage' | 'leases.view' | 'leases.manage'
  | 'ledger.view' | 'payments.record' | 'charges.manage' | 'deposits.manage' | 'expenses.manage' | 'entries.reverse'
  | 'reports.view' | 'staff.manage' | 'meters.view';

export interface LandlordAccessInfo {
  landlordId: string;
  landlordName: string;
  role: OrgRole;
  permissions: LandlordPermission[];
  allProperties: boolean;
  propertyIds: string[];
}

export interface PropertyLocation {
  id: string;
  name: string;
  county: string | null;
  description: string | null;
  properties: { id: string; name: string }[];
  propertyCount: number;
  units: number;
  occupied: number;
}

export type LeaseStatus = 'ACTIVE' | 'ENDED' | 'TERMINATED';
export type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
export type PaymentMethod = 'MPESA' | 'CASH' | 'BANK' | 'CHEQUE' | 'OTHER';

export type RentClaimPurpose = 'RENT' | 'DEPOSIT';
export type RentClaimStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

/** A payment a tenant reported from the tenant portal, waiting for (or after) the landlord's check. */
export interface RentPaymentClaim {
  id: string;
  purpose: RentClaimPurpose;
  method: 'MPESA' | 'CASH';
  amount: Money;
  paidOn: string;
  reference: string | null;
  note: string | null;
  status: RentClaimStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  lease: { id: string; code: string; unit: { id: string; name: string }; property: { id: string; name: string } };
  tenant: { id: string; name: string; phone: string };
}
export type LedgerEntryType =
  | 'RENT_CHARGE' | 'OTHER_CHARGE' | 'PAYMENT' | 'CREDIT' | 'DEPOSIT_RECEIVED' | 'DEPOSIT_REFUND' | 'DEPOSIT_APPLIED' | 'EXPENSE';

export interface Aging { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }

export interface LeaseAccount {
  charged: number;
  settled: number;
  balance: number;
  arrears: number;
  depositHeld: number;
  aging: Aging;
  oldestUnpaidDue: string | null;
}

export interface Lease {
  id: string;
  code: string;
  rentAmount: Money;
  depositAmount: Money;
  billingFrequency: BillingFrequency;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  status: LeaseStatus;
  nextBillingDate: string | null;
  notes: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  createdAt: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  tenant: { id: string; name: string; phone: string; email: string | null; idNumber: string | null };
  unit: { id: string; name: string; unitNumber: string | null };
  property: { id: string; name: string; locationGroup: { id: string; name: string } | null };
  account: LeaseAccount;
  monthlyRent?: number;
  nextCharge?: { periodStart: string; periodEnd: string; dueDate: string; amount: number } | null;
}

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  amount: Money;
  entryDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  method: PaymentMethod | null;
  reference: string | null;
  category: string | null;
  description: string | null;
  reversalOfId: string | null;
  reversed: boolean;
  createdAt: string;
  propertyId: string;
  leaseId: string | null;
  lease?: { id: string; code: string } | null;
  tenant?: { id: string; name: string; phone: string } | null;
  unit?: { id: string; name: string } | null;
  property?: { id: string; name: string } | null;
  /** Statement rows only. */
  balance?: number;
  depositHeld?: number;
}

export interface VacantUnit {
  id: string;
  name: string;
  unitNumber: string | null;
  monthlyRent: Money | null;
  depositAmount: Money | null;
  property: { id: string; name: string };
}

export interface ArrearsRow extends LeaseAccount {
  id: string;
  code: string;
  status: LeaseStatus;
  tenant: { name: string; phone: string };
  unit: { name: string };
  property: { name: string };
}

export interface RentReportRow {
  id: string;
  name: string;
  location: string | null;
  properties: number;
  units: number;
  occupied: number;
  vacant: number;
  occupancyRate: number | null;
  rentRoll: number;
  billed: number;
  collected: number;
  credits: number;
  collectionRate: number | null;
  expenses: number;
  net: number;
  arrears: number;
  aging: Aging;
  depositsHeld: number;
}

export interface RentReport {
  from: string;
  to: string;
  groupBy: 'property' | 'location';
  rows: RentReportRow[];
  totals: RentReportRow;
  expensesByCategory: { category: string; amount: number }[];
}

export interface LandlordStaffMember {
  id: string;
  staffRole: StaffRole;
  allProperties: boolean;
  propertyIds: string[];
  createdAt: string;
  user: { id: string; name: string; email: string; username: string; phone: string | null; status: AccountStatus; createdAt: string };
}

// ── Prism diagnostic (admin "Prism Test") ────────────────────────────────────

export type PrismControlType = 'CLEAR_TAMPER' | 'CLEAR_CREDIT' | 'SET_MAX_OVERDRAFT';

export interface PrismTestStep {
  key: 'config' | 'connect' | 'auth' | 'generate';
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail?: string;
}

export interface PrismTestResult {
  ok: boolean;
  meterNumber: string;
  tokenType: 'CREDIT' | PrismControlType;
  amount: number | null;
  controlValue: number | null;
  source: 'database' | 'defaults' | 'raw';
  meter: { type: string; status: string; owner: string | null } | null;
  vendingDefaults: Record<string, number>;
  sts: { sgc: number; krn: number; ti: number; ea: number; tct: number; ken: number } | null;
  prism: { host: string; port: number };
  steps: PrismTestStep[];
  tokens: { token: string; description: string | null; quantity: string | null }[];
  messageId: string | null;
  error: { message: string; code?: string; details?: string } | null;
  startedAt: string;
  durationMs: number;
}
