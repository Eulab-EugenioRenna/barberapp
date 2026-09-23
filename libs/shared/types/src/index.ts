export enum UserRole {
  PlatformAdmin = 'platform_admin',
  Owner = 'owner',
  Manager = 'manager',
  Collaborator = 'collaborator',
  Reception = 'reception',
  Client = 'client'
}

export enum BookingMode {
  Public = 'public',
  Closed = 'closed',
  Hybrid = 'hybrid'
}

export enum AppointmentStatus {
  Draft = 'draft',
  Requested = 'requested',
  Confirmed = 'confirmed',
  CheckedIn = 'checked_in',
  Completed = 'completed',
  Cancelled = 'cancelled',
  NoShow = 'no_show',
  Rescheduled = 'rescheduled'
}

export enum AppointmentSource {
  Public = 'public',
  Internal = 'internal',
  Import = 'import',
  Api = 'api'
}

export enum PaymentStatus {
  Unpaid = 'unpaid',
  Paid = 'paid',
  Partial = 'partial',
  Refunded = 'refunded',
  Cancelled = 'cancelled'
}

export enum NotificationChannel {
  Email = 'email',
  Telegram = 'telegram',
  WhatsApp = 'whatsapp',
  InApp = 'in_app',
  Webhook = 'webhook'
}

export enum NotificationStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
  Skipped = 'skipped'
}

export type Permission =
  | 'appointments.read.all'
  | 'appointments.read.own'
  | 'appointments.create'
  | 'appointments.update.all'
  | 'appointments.update.own'
  | 'clients.read.full'
  | 'clients.read.limited'
  | 'services.manage'
  | 'collaborators.manage'
  | 'rooms.manage'
  | 'products.manage'
  | 'sales.create'
  | 'dashboard.revenue.read'
  | 'settings.manage'
  | 'audit.read';

export interface TenantBranding {
  companyName: string;
  slug: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  timezone: string;
  currency: string;
  language: string;
  bookingMode: BookingMode;
}

export interface DashboardMetric {
  label: string;
  value: string;
  trend: string;
}

export interface PublicServiceSummary {
  id: string;
  name: string;
  publicDescription: string;
  durationMinutes: number;
  basePrice: number;
  color: string;
}

export interface AppointmentSummary {
  id: string;
  customerName: string;
  serviceName: string;
  collaboratorName?: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
}
