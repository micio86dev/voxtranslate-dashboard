/**
 * Typed client for the VoxTranslate `/api/business/...` backend. Mirrors the
 * consumer app's fetch-wrapper style: build the URL from API_BASE, attach the
 * bearer token, parse JSON, and surface the HTTP status so callers can react to
 * 401/402/403/404.
 */
import { API_BASE, authHeaders } from './auth';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = { ...authHeaders() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: T | null = null;
    if (res.status !== 204) {
      data = (await res.json().catch(() => null)) as T | null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// --- Types -------------------------------------------------------------------

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  /** 'none' | 'active' | 'past_due' | 'canceled'. */
  subscription_status: string;
  credits_balance: number;
  role: string;
}

export interface OrgSettings {
  retention_days?: number;
  compliance_mode?: boolean;
  allowed_domains?: string[];
  recording_notify_participants?: boolean;
}

export interface OrgDetail extends Omit<OrgSummary, 'role'> {
  settings: OrgSettings;
  role: string;
}

export interface Member {
  user_id: string;
  role: string;
  name: string;
  email: string;
  avatar_url: string | null;
  joined_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  join_url: string;
  email_sent: boolean;
}

export interface InviteInfo {
  org_name: string;
  email: string;
  role: string;
  expires_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  default_languages: string[];
  archived_at: string | null;
  created_at: string;
}

// --- Organizations -----------------------------------------------------------

export const listOrgs = () => request<OrgSummary[]>('GET', '/api/business/organizations');

export const createOrg = (body: { name: string; slug: string; plan?: string }) =>
  request<OrgSummary>('POST', '/api/business/organizations', body);

export const getOrg = (orgId: string) =>
  request<OrgDetail>('GET', `/api/business/organizations/${orgId}`);

export const patchOrg = (orgId: string, body: { name?: string; settings?: OrgSettings }) =>
  request<OrgDetail>('PATCH', `/api/business/organizations/${orgId}`, body);

// --- Members & invites -------------------------------------------------------

export const listMembers = (orgId: string) =>
  request<Member[]>('GET', `/api/business/organizations/${orgId}/members`);

export const createInvite = (orgId: string, body: { email: string; role?: string }) =>
  request<Invite>('POST', `/api/business/organizations/${orgId}/invites`, body);

export const getInvite = (token: string) =>
  request<InviteInfo>('GET', `/api/business/invites/${encodeURIComponent(token)}`);

export const acceptInvite = (token: string) =>
  request<{ org_id: string; role: string }>(
    'POST',
    `/api/business/invites/${encodeURIComponent(token)}/accept`,
  );

export const removeMember = (orgId: string, userId: string) =>
  request<null>('DELETE', `/api/business/organizations/${orgId}/members/${userId}`);

export const changeMemberRole = (orgId: string, userId: string, role: string) =>
  request<{ user_id: string; role: string }>(
    'PATCH',
    `/api/business/organizations/${orgId}/members/${userId}`,
    { role },
  );

// --- Projects ----------------------------------------------------------------

export const listProjects = (orgId: string) =>
  request<Project[]>('GET', `/api/business/organizations/${orgId}/projects`);

export const createProject = (
  orgId: string,
  body: { name: string; description?: string; default_languages?: string[] },
) => request<Project>('POST', `/api/business/organizations/${orgId}/projects`, body);

export const getProject = (orgId: string, projectId: string) =>
  request<Project>('GET', `/api/business/organizations/${orgId}/projects/${projectId}`);

export const patchProject = (
  orgId: string,
  projectId: string,
  body: { name?: string; description?: string; default_languages?: string[] },
) => request<Project>('PATCH', `/api/business/organizations/${orgId}/projects/${projectId}`, body);

export const deleteProject = (orgId: string, projectId: string) =>
  request<null>('DELETE', `/api/business/organizations/${orgId}/projects/${projectId}`);

// --- Call history ------------------------------------------------------------

export interface RoomRow {
  id: string;
  room: string;
  started_at: string;
  ended_at: string | null;
  project_id: string | null;
  transcript_status: string;
  has_recording: boolean;
}

export interface HistoryPage {
  rooms: RoomRow[];
  page: number;
  limit: number;
}

export interface HistoryQuery {
  project_id?: string;
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

export const listOrgRooms = (orgId: string, q: HistoryQuery = {}) => {
  const params = new URLSearchParams();
  if (q.project_id) params.set('project_id', q.project_id);
  if (q.page) params.set('page', String(q.page));
  if (q.limit) params.set('limit', String(q.limit));
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const qs = params.toString();
  return request<HistoryPage>(
    'GET',
    `/api/business/organizations/${orgId}/rooms${qs ? `?${qs}` : ''}`,
  );
};

// --- Transcripts -------------------------------------------------------------

export interface Segment {
  speaker_id: string;
  speaker_name: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscriptDoc {
  status: string;
  source_language?: string;
  segments: Segment[];
  duration_seconds?: number | null;
  word_count?: number | null;
  translated_languages?: string[];
}

export interface TranslateResult {
  language: string;
  text: string;
  cached: boolean;
  credits_deducted: number;
}

export const getTranscript = (sessionId: string) =>
  request<TranscriptDoc>('GET', `/api/business/rooms/${sessionId}/transcript`);

export const translateTranscript = (sessionId: string, target_language: string) =>
  request<TranslateResult>('POST', `/api/business/rooms/${sessionId}/transcript/translate`, {
    target_language,
  });

export const recordingUrl = (sessionId: string) =>
  request<{ url: string; expires_in: number }>(
    'GET',
    `/api/business/rooms/${sessionId}/recording/url`,
  );

/** Fetch the transcript export (auth header needed) and trigger a download. */
export async function downloadTranscript(
  sessionId: string,
  format: 'txt' | 'pdf',
  language?: string,
): Promise<boolean> {
  const params = new URLSearchParams({ format });
  if (language) params.set('language', language);
  try {
    const res = await fetch(
      `${API_BASE}/api/business/rooms/${sessionId}/transcript/export?${params}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${sessionId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

// --- Semantic transcript search ----------------------------------------------

export interface SearchResult {
  session_id: string;
  project_id: string | null;
  project_name: string | null;
  room: string;
  started_at: string;
  /** Matched transcript chunk, shown as the result snippet. */
  snippet: string;
  speaker_name: string | null;
  start_ms: number | null;
  /** Cosine similarity (0–1); higher is closer. */
  score: number;
}

export interface SearchQuery {
  q: string;
  /** Narrow to one project; omit to search every project the caller may see. */
  project_id?: string;
  limit?: number;
}

/**
 * Semantic search over the org's diarized transcripts, scoped server-side to the
 * caller's role (members: own/participated projects; admins: all). 503 when the
 * backend has no embeddings provider configured.
 */
export const searchTranscripts = (orgId: string, q: SearchQuery) => {
  const params = new URLSearchParams();
  params.set('q', q.q);
  if (q.project_id) params.set('project_id', q.project_id);
  if (q.limit) params.set('limit', String(q.limit));
  return request<{ results: SearchResult[] }>(
    'GET',
    `/api/business/organizations/${orgId}/search?${params.toString()}`,
  );
};

// --- Org billing -------------------------------------------------------------

export interface LedgerTxn {
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

export interface CreditsView {
  balance: number;
  transactions: LedgerTxn[];
}

export const getCredits = (orgId: string) =>
  request<CreditsView>('GET', `/api/business/organizations/${orgId}/credits`);

export const purchaseCredits = (orgId: string, credits_amount: number) =>
  request<{ url: string }>('POST', `/api/business/organizations/${orgId}/credits/purchase`, {
    credits_amount,
  });

export const subscribe = (orgId: string, plan: string, interval: string) =>
  request<{ url: string }>('POST', `/api/business/organizations/${orgId}/subscription`, {
    plan,
    interval,
  });

/**
 * Subscription detail for the billing box. Always carries the DB-known fields;
 * the live-Stripe overlay fields (start date, amount, card …) are present only
 * when the org has a real subscription, and may be null on a Stripe hiccup.
 */
export interface SubscriptionDetail {
  /** Coarse status: 'none' | 'active' | 'past_due' | 'canceled'. */
  status: string;
  plan: string;
  /** 'month' | 'year' | null. */
  interval: string | null;
  /** ISO-8601, end of the current paid period (renewal/expiry). */
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  // --- live Stripe overlay (present when subscribed) ---
  /** Raw Stripe status, e.g. 'active' | 'trialing' | 'past_due' | 'canceled'. */
  stripe_status?: string | null;
  start_date?: string | null;
  current_period_start?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
  /** Amount per interval, in the currency's minor unit (cents). */
  amount?: number | null;
  currency?: string | null;
  card_brand?: string | null;
  card_last4?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
}

export const getSubscription = (orgId: string) =>
  request<SubscriptionDetail>('GET', `/api/business/organizations/${orgId}/subscription`);

export const billingPortal = (orgId: string) =>
  request<{ url: string }>('POST', `/api/business/organizations/${orgId}/subscription/portal`);

// --- Teams -------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
}

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  joined_at: string;
}

export const listTeams = (orgId: string) =>
  request<Team[]>('GET', `/api/business/organizations/${orgId}/teams`);

export const createTeam = (orgId: string, name: string) =>
  request<Team>('POST', `/api/business/organizations/${orgId}/teams`, { name });

export const renameTeam = (orgId: string, teamId: string, name: string) =>
  request<Team>('PATCH', `/api/business/organizations/${orgId}/teams/${teamId}`, { name });

export const deleteTeam = (orgId: string, teamId: string) =>
  request<null>('DELETE', `/api/business/organizations/${orgId}/teams/${teamId}`);

export const listTeamMembers = (orgId: string, teamId: string) =>
  request<TeamMember[]>('GET', `/api/business/organizations/${orgId}/teams/${teamId}/members`);

export const addTeamMember = (orgId: string, teamId: string, user_id: string) =>
  request<null>('POST', `/api/business/organizations/${orgId}/teams/${teamId}/members`, {
    user_id,
  });

export const removeTeamMember = (orgId: string, teamId: string, userId: string) =>
  request<null>('DELETE', `/api/business/organizations/${orgId}/teams/${teamId}/members/${userId}`);

// --- Analytics ---------------------------------------------------------------

export interface AnalyticsKpis {
  calls: number;
  minutes: number;
  transcripts: number;
  recordings: number;
  credits_spent: number;
}

export interface AnalyticsDay {
  day: string;
  calls: number;
  minutes: number;
}

export interface AnalyticsTypeSpend {
  type: string;
  spent: number;
}

export interface AnalyticsProject {
  project_id: string;
  name: string;
  calls: number;
  minutes: number;
}

export interface AnalyticsSummary {
  range_days: number;
  kpis: AnalyticsKpis;
  credits_by_type: AnalyticsTypeSpend[];
  calls_by_day: AnalyticsDay[];
  top_projects: AnalyticsProject[];
}

export const getAnalytics = (orgId: string, days = 30) =>
  request<AnalyticsSummary>('GET', `/api/business/organizations/${orgId}/analytics?days=${days}`);

export interface MemberAnalytics {
  range_days: number;
  user: { id: string; name: string; email: string };
  calls: number;
  minutes_in_calls: number;
  credits_spent: number;
  credits_by_type: AnalyticsTypeSpend[];
  collaborators: { name: string; calls: number }[];
}

export const getMemberAnalytics = (orgId: string, userId: string, days = 30) =>
  request<MemberAnalytics>(
    'GET',
    `/api/business/organizations/${orgId}/members/${userId}/analytics?days=${days}`,
  );

// --- Scheduled meetings (Google Calendar) ------------------------------------

export interface ScheduledMeeting {
  id: string;
  org_id: string | null;
  project_id: string | null;
  title: string;
  description: string | null;
  scheduled_at: string;
  end_at: string;
  timezone: string;
  room_code: string;
  join_url: string;
  status: string;
  reminder_minutes_before: number;
  /** RRULE string for a recurring series, or null for a one-off meeting. */
  recurrence: string | null;
  created_at: string;
}

export interface MeetingRecurrence {
  /** 'DAILY' | 'WEEKLY' | 'MONTHLY'. */
  freq: string;
  interval?: number;
  /** Number of occurrences (mutually exclusive with `until`). */
  count?: number;
  /** ISO end date. */
  until?: string;
}

export interface MeetingInvitee {
  user_id: string | null;
  email: string;
  role: string;
  rsvp_status: string;
}

export interface MeetingDetail extends ScheduledMeeting {
  invitees: MeetingInvitee[];
}

export interface MeetingCreate {
  title: string;
  description?: string;
  /** ISO-8601 start. */
  scheduled_at: string;
  end_at?: string;
  duration_minutes?: number;
  timezone?: string;
  project_id?: string;
  reminder_minutes_before?: number;
  /** Org members invited (by user id) — resolved to their account email. */
  invitee_user_ids?: string[];
  /** External invitees by email. */
  invitee_emails?: string[];
  /** Optional recurrence; omit for a one-off meeting. */
  recurrence?: MeetingRecurrence;
}

export interface MeetingsQuery {
  from?: string;
  to?: string;
}

export const listMeetings = (orgId: string, q: MeetingsQuery = {}) => {
  const params = new URLSearchParams();
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const qs = params.toString();
  return request<ScheduledMeeting[]>(
    'GET',
    `/api/business/organizations/${orgId}/meetings${qs ? `?${qs}` : ''}`,
  );
};

export const createMeeting = (orgId: string, body: MeetingCreate) =>
  request<MeetingDetail>('POST', `/api/business/organizations/${orgId}/meetings`, body);

export const getMeeting = (orgId: string, meetingId: string) =>
  request<MeetingDetail>('GET', `/api/business/organizations/${orgId}/meetings/${meetingId}`);

export const updateMeeting = (orgId: string, meetingId: string, body: MeetingCreate) =>
  request<MeetingDetail>(
    'PATCH',
    `/api/business/organizations/${orgId}/meetings/${meetingId}`,
    body,
  );

export const cancelMeeting = (orgId: string, meetingId: string) =>
  request<null>('POST', `/api/business/organizations/${orgId}/meetings/${meetingId}/cancel`);

// --- Activity / audit log ----------------------------------------------------

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditQuery {
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const listAudit = (orgId: string, query: AuditQuery = {}) => {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q) params.set('q', query.q);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return request<{ entries: AuditEntry[]; page: number; limit: number }>(
    'GET',
    `/api/business/organizations/${orgId}/audit${qs ? `?${qs}` : ''}`,
  );
};

// --- Notifications -----------------------------------------------------------

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsPage {
  notifications: NotificationItem[];
  unread: number;
}

export interface NotifPref {
  type: string;
  channel: string;
  enabled: boolean;
}

export interface NotifPreferences {
  preferences: NotifPref[];
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  timezone: string;
}

export const getVapidKey = () => request<{ key: string }>('GET', '/api/push/vapid-public-key');

export const subscribePush = (body: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}) => request<null>('POST', '/api/push/subscribe', body);

export const unsubscribePush = (endpoint: string) =>
  request<null>('DELETE', '/api/push/subscribe', { endpoint });

export const listNotifications = (q: { unread?: boolean; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (q.unread) params.set('unread', 'true');
  if (q.limit) params.set('limit', String(q.limit));
  const qs = params.toString();
  return request<NotificationsPage>('GET', `/api/notifications${qs ? `?${qs}` : ''}`);
};

export const markNotificationRead = (id: string) =>
  request<null>('POST', `/api/notifications/${id}/read`);

export const markAllNotificationsRead = () => request<null>('POST', '/api/notifications/read-all');

export const getNotifPreferences = () =>
  request<NotifPreferences>('GET', '/api/notifications/preferences');

export const patchNotifPreferences = (body: Partial<NotifPreferences>) =>
  request<null>('PATCH', '/api/notifications/preferences', body);

// --- Project storyboard ------------------------------------------------------

export interface ProjectStoryboard {
  project_id: string;
  target_workflow: string | null;
  markdown: string;
  model: string;
  updated_at: string;
}

export const getStoryboard = (orgId: string, projectId: string) =>
  request<ProjectStoryboard>(
    'GET',
    `/api/business/organizations/${orgId}/projects/${projectId}/storyboard`,
  );

export const generateStoryboard = (
  orgId: string,
  projectId: string,
  body: { target_workflow?: string; lang?: string },
) =>
  request<ProjectStoryboard>(
    'POST',
    `/api/business/organizations/${orgId}/projects/${projectId}/storyboard`,
    body,
  );

// --- Current-org helper (persisted selection) --------------------------------

const ORG_KEY = 'voxb.org';

export function currentOrgId(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setCurrentOrgId(id: string): void {
  try {
    localStorage.setItem(ORG_KEY, id);
  } catch {
    /* ignore */
  }
}
