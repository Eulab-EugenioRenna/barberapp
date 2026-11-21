/** Public projections shared with Angular; provider credentials never enter this contract. */
export interface PersonalSecurity {
  totp: boolean;
  preferredMethod: "auto" | "totp" | "email";
  emailVerified: boolean;
  requiredActions: string[];
  authenticators: { id: string; name: string; createdAt: number | null }[];
  trustedDevices: { id: string; name: string; createdAt: number | null; expiresAt: number | null }[];
}

export interface PersonalSession {
  id: string;
  ipAddress: string;
  startedAt: number;
  lastAccess: number;
  clients: string[];
  current: boolean;
}

export interface PersonalAccount {
  profile: { firstName: string; lastName: string; email: string };
  accountUrl: string;
}

export interface PersonalSessionList { sessions: PersonalSession[]; truncated: boolean }
export interface PersonalNotices {
  items: { id: string; title: string; body: string; created_at: string; read_at: string | null }[];
  unreadCount: number;
}
