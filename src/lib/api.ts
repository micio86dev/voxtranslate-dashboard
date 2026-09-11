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
  /** 'none' | 'active' | 'past_due' | 'canceled', exactly as stored. */
  subscription_status: string;
  /**
   * Whether the subscription is live RIGHT NOW — the stored status AND an
   * unexpired period, the same rule the server gates on. Gate on THIS, not on
   * `subscription_status`: a gifted subscription lapses by date with no Stripe
   * webhook to change its status, so the row still says 'active' long after the
   * period ended and the two disagree.
   */
  subscription_active: boolean;
  /** End of the paid period — when it lapsed, or when it renews. */
  current_period_end: string | null;
  /**
   * Whether Stripe knows this org. The Billing Portal exists only for a customer
   * and 409s without one, so this — not the subscription status — decides
   * between "manage your subscription" and "start one".
   */
  has_stripe_customer: boolean;
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

// --- Project voice messages --------------------------------------------------

export interface ProjectVoiceMessage {
  id: string;
  session_id: string;
  transcript_id: string | null;
  created_by_name: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  source_language: string;
  word_count: number | null;
  translated: boolean;
  created_at: string;
}

export interface VoiceMessageCreated {
  id: string;
  translated: boolean;
  /** 'credits' (org out of credits, saved untranslated) | 'error' (Groq failed). */
  translate_blocked: string | null;
}

export const listVoiceMessages = (orgId: string, projectId: string) =>
  request<{ voice_messages: ProjectVoiceMessage[] }>(
    'GET',
    `/api/business/organizations/${orgId}/projects/${projectId}/voice-messages`,
  );

export const voiceMessageAudioUrl = (orgId: string, projectId: string, voiceMessageId: string) =>
  request<{ url: string }>(
    'GET',
    `/api/business/organizations/${orgId}/projects/${projectId}/voice-messages/${voiceMessageId}/audio-url`,
  );

/** Upload a recorded voice note to a project (multipart — the JSON `request`
 *  helper can't carry a file). The server transcribes + translates + persists it
 *  into the project's insights data. */
export async function uploadVoiceMessage(
  orgId: string,
  projectId: string,
  file: File,
  durationSeconds: number | null,
): Promise<ApiResult<VoiceMessageCreated>> {
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    if (durationSeconds != null)
      form.append('duration_seconds', String(Math.round(durationSeconds)));
    // No Content-Type header — the browser sets the multipart boundary itself.
    const res = await fetch(
      `${API_BASE}/api/business/organizations/${orgId}/projects/${projectId}/voice-messages`,
      { method: 'POST', headers: { ...authHeaders() }, body: form },
    );
    const data =
      res.status !== 204
        ? ((await res.json().catch(() => null)) as VoiceMessageCreated | null)
        : null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// --- Call history ------------------------------------------------------------

export interface RoomRow {
  id: string;
  room: string;
  started_at: string;
  ended_at: string | null;
  project_id: string | null;
  project_name: string | null;
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
  /** Comma-separated participant user-ids (OR filter). */
  member_ids?: string;
}

export const listOrgRooms = (orgId: string, q: HistoryQuery = {}) => {
  const params = new URLSearchParams();
  if (q.project_id) params.set('project_id', q.project_id);
  if (q.page) params.set('page', String(q.page));
  if (q.limit) params.set('limit', String(q.limit));
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.member_ids) params.set('member_ids', q.member_ids);
  const qs = params.toString();
  return request<HistoryPage>(
    'GET',
    `/api/business/organizations/${orgId}/rooms${qs ? `?${qs}` : ''}`,
  );
};

// --- Webinar history ---------------------------------------------------------

export interface WebinarRow {
  id: string;
  code: string;
  title: string;
  /** 'scheduled' | 'live' | 'ended' | 'archived' (server-defined status). */
  status: string;
  tier: string;
  project_id: string | null;
  project_name: string | null;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  duration_seconds: number | null;
  peak_viewers: number | null;
  cost_credits: number | null;
  has_report: boolean;
}

export interface WebinarsPage {
  webinars: WebinarRow[];
  page: number;
  limit: number;
}

export interface WebinarsQuery {
  project_id?: string;
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
  include_archived?: boolean;
}

export const listOrgWebinars = (orgId: string, q: WebinarsQuery = {}) => {
  const params = new URLSearchParams();
  if (q.project_id) params.set('project_id', q.project_id);
  if (q.page) params.set('page', String(q.page));
  if (q.limit) params.set('limit', String(q.limit));
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.status) params.set('status', q.status);
  if (q.include_archived) params.set('include_archived', 'true');
  const qs = params.toString();
  return request<WebinarsPage>(
    'GET',
    `/api/business/organizations/${orgId}/webinars${qs ? `?${qs}` : ''}`,
  );
};

export interface WebinarInfo {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  tier: string;
  source_language: string | null;
  project_id: string | null;
  project_name: string | null;
  host_user_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface WebinarSession {
  actual_start: string | null;
  actual_end: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  duration_seconds: number | null;
  host_online_seconds: number | null;
  peak_viewers: number | null;
  translated_language_count: number | null;
  cost_credits: number | null;
}

export interface WebinarParticipant {
  name: string;
  language_code: string | null;
  total_watch_seconds: number | null;
  joined_at: string | null;
  last_seen: string | null;
  approx_country: string | null;
}

export interface WebinarEmailStatus {
  status: string;
  count: number;
}

export interface WebinarDetail {
  webinar: WebinarInfo;
  /** null until the webinar is finalized (no session row yet). */
  session: WebinarSession | null;
  participants: WebinarParticipant[];
  report: { available: boolean; languages: string[] };
  emails: { total: number; by_status: WebinarEmailStatus[] };
}

export const getWebinarDetail = (orgId: string, webinarId: string) =>
  request<WebinarDetail>('GET', `/api/business/organizations/${orgId}/webinars/${webinarId}`);

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
  /** 'recording' = diarized from the cloud recording; 'live' = reconstructed from
   *  the realtime transcript captured during the call (no recording was made). */
  source?: 'recording' | 'live';
  source_language?: string;
  /** Live transcripts only: the language each segment's `text` was resolved into. */
  reading_language?: string;
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

// `lang` is the language the reader wants the call in. A call transcript is
// multilingual, so the server resolves each line to this language — the speaker's own
// words where they already spoke it, their translation where they did not. Omitting it
// falls back to the language the reader themselves used in that call.
export const getTranscript = (sessionId: string, lang?: string) =>
  request<TranscriptDoc>(
    'GET',
    `/api/business/rooms/${sessionId}/transcript${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`,
  );

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

/** One row of the public plan catalogue (`GET /api/business/plans`). */
export interface OrgPlanOffer {
  plan: 'business' | 'enterprise';
  interval: 'month' | 'year';
  unit_amount: number;
  currency: string;
  active: boolean;
  /**
   * Credits each paid invoice grants, from `ORG_CREDITS_*` on the server. Read
   * it, never restate it: a copy here would be one more number to drift, which
   * is exactly how the marketing site once advertised prices in the wrong
   * currency for two months.
   */
  credits: number;
}

/** The plan catalogue. Public — no org, no auth. */
export const getPlans = () => request<{ plans: OrgPlanOffer[] }>('GET', '/api/business/plans');

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

// --- Invoices (spec 0109) ----------------------------------------------------

/** One billing document. Amounts are integer minor units (cents). */
export interface Invoice {
  id: string;
  /** Issuer's invoice number; null only for a document not yet numbered. */
  number: string | null;
  /** ISO-8601 issue date — what the monthly grouping is keyed on. */
  issued_at: string;
  period_start: string | null;
  period_end: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  /** Issuer status, e.g. 'paid' | 'open' | 'void' | 'uncollectible'. */
  status: string;
  hosted_invoice_url: string | null;
}

/** Invoices for one calendar month (`YYYY-MM`, UTC), newest month first. */
export interface InvoiceMonth {
  month: string;
  invoices: Invoice[];
}

export const getOrgInvoices = (orgId: string) =>
  request<{ months: InvoiceMonth[] }>('GET', `/api/business/organizations/${orgId}/invoices`);

/**
 * Resolve an invoice's download URL. The server re-fetches it from the issuer on
 * every call because those links expire — so never cache the result, just open
 * it straight away.
 */
export const getOrgInvoicePdf = (orgId: string, invoiceId: string) =>
  request<{ url: string }>('GET', `/api/business/organizations/${orgId}/invoices/${invoiceId}/pdf`);

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
  /** 'lead' | 'member' — leads can run the insights assistant for this team. */
  role: string;
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

export const setTeamMemberRole = (orgId: string, teamId: string, userId: string, role: string) =>
  request<{ user_id: string; role: string }>(
    'PATCH',
    `/api/business/organizations/${orgId}/teams/${teamId}/members/${userId}`,
    { role },
  );

// --- Insights assistant (team-lead / owner) ----------------------------------

export interface InsightSource {
  session_id: string;
  room: string;
  project_name: string | null;
  speaker_name: string | null;
  snippet: string;
}

export interface InsightResult {
  answer_markdown: string;
  sources: InsightSource[];
  model: string;
}

export interface InsightBody {
  mode: 'qa' | 'project_report' | 'member_report';
  question?: string;
  project_id?: string;
  member_id?: string;
}

/**
 * Generate an insight (Q&A or structured report) over the caller's team scope.
 * 403 if the caller leads no team and isn't the owner; 503 if embeddings aren't
 * configured.
 */
export const generateInsight = (orgId: string, body: InsightBody) =>
  request<InsightResult>('POST', `/api/business/organizations/${orgId}/insights`, body);

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

/** Webinar KPI block within the org analytics summary. */
export interface AnalyticsWebinars {
  webinars_hosted: number;
  peak_viewers_max: number;
  total_broadcast_hours: number;
  total_watch_hours: number;
  webinar_spend: number;
}

export interface AnalyticsSummary {
  range_days: number;
  kpis: AnalyticsKpis;
  credits_by_type: AnalyticsTypeSpend[];
  calls_by_day: AnalyticsDay[];
  top_projects: AnalyticsProject[];
  /** Webinar KPIs (webinar-analytics epic). May be absent on older servers. */
  webinars?: AnalyticsWebinars;
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

// --- Voice Assistant (B2B) ---------------------------------------------------

/**
 * Build the WebSocket URL for the voice-assistant endpoint from an explicit
 * API base URL. The protocol swap (https→wss, http→ws) is applied here.
 *
 * Accepting `apiBase` as a parameter makes this function unit-testable without
 * mocking the module-level `API_BASE` constant. It is re-exported from
 * `voice-assistant.ts` so consumers import from a single source.
 */
export function buildWsUrl(
  apiBase: string,
  orgId: string,
  opts: { project_id?: string; member_id?: string } = {},
): string {
  const base = apiBase
    .replace(/\/+$/, '')
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
  const path = `${base}/api/business/organizations/${orgId}/voice-assistant`;
  const params = new URLSearchParams();
  if (opts.project_id) params.set('project_id', opts.project_id);
  if (opts.member_id) params.set('member_id', opts.member_id);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Build the WebSocket URL for the voice-assistant endpoint using the
 * module-level `API_BASE`. Convenience wrapper around `buildWsUrl`.
 */
export function voiceAssistantWsUrl(
  orgId: string,
  opts: { project_id?: string; member_id?: string } = {},
): string {
  return buildWsUrl(API_BASE, orgId, opts);
}

// --- Help Assistant (B2B) ----------------------------------------------------

/**
 * Build the WebSocket URL for the help-assistant endpoint from an explicit
 * API base URL. Protocol swap (https→wss, http→ws) is applied here.
 *
 * Parameterised for unit-testability (no dependency on module-level API_BASE).
 * The caller is responsible for appending `?token=` before connecting.
 */
export function buildHelpAssistantWsUrl(apiBase: string, orgId: string): string {
  const base = apiBase
    .replace(/\/+$/, '')
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
  return `${base}/api/business/organizations/${orgId}/help-assistant`;
}

/**
 * Build the WebSocket URL for the help-assistant endpoint using the
 * module-level `API_BASE`. Convenience wrapper around `buildHelpAssistantWsUrl`.
 */
export function helpAssistantWsUrl(orgId: string): string {
  return buildHelpAssistantWsUrl(API_BASE, orgId);
}

// --- Translated phone calls (spec 0111) --------------------------------------

/**
 * A quote is deliberately the SAME gate as placing the call: if the policy would
 * refuse the call, the quote refuses too. A price shown for a call that is then
 * rejected is worse than showing no price at all.
 */
export interface VoipQuote {
  /** Masked form only — the quote payload reaches a browser console. */
  destination: string;
  country: string;
  price_per_minute: string;
  currency: string;
  reserve_credits: number;
  estimated_minutes: number;
  balance_credits: number;
  engine_id: string;
  recording: boolean;
  transcription: boolean;
  consent_policy: string;
  /** Set when an announcement will be played, and in which language. */
  disclosure_language: string | null;
}

export interface VoipCallSummary {
  id: string;
  status: string;
  failure_reason: string | null;
  direction: string;
  recipient_country: string;
  /** `+39••••1234`. The full number is on the detail endpoint only. */
  recipient_masked: string;
  source_language: string;
  target_language: string;
  engine_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  credits_consumed: number;
  recording_status: string;
  transcription_status: string;
  consent_status: string;
  project_id: string | null;
  project_name: string | null;
}

export interface VoipCallDetail extends Omit<VoipCallSummary, 'recipient_masked'> {
  session_id: string;
  /** The full E.164 number. This endpoint is the only place it is returned. */
  recipient_e164: string;
  quoted_price_per_min: string | null;
  /**
   * `'pending'` until the provider rates the leg, then `'final'`.
   *
   * A status and not a number, on purpose (spec 0112 R6). What the leg cost us and the
   * margin we made on it are business-internal and never leave the server — the same
   * rule `engine/metadata.rs` enforces for the engine catalogue. What the customer
   * agreed to and what they paid are above, and both are still here.
   *
   * Reported as pending rather than as zero, because a zero reads as "this call was
   * free", which is a very different claim from "not rated yet".
   */
  cost_status: 'pending' | 'final';
  /** Who was called, when the address book knew. Null once that contact is deleted. */
  contact_id: string | null;
  contact_name: string | null;
}

export interface VoipSettings {
  enabled: boolean;
  home_country: string | null;
  allowed_countries: string[];
  blocked_countries: string[];
  allow_international: boolean;
  consent_policy: string;
  consent_refused_action: string;
  recording_enabled: boolean;
  transcription_enabled: boolean;
  ai_analysis_enabled: boolean;
  max_call_minutes: number;
  max_concurrent_per_user: number;
  max_concurrent_per_org: number;
  default_engine_id: string | null;
  require_project: boolean;
}

export interface VoipDialRequest {
  destination: string;
  source_language: string;
  target_language: string;
  engine_id?: string;
  project_id?: string | null;
  caller_id?: string | null;
  record?: boolean;
  transcribe?: boolean;
  ai_analysis?: boolean;
  estimated_minutes?: number;
}

export interface VoipCallCreated {
  call_id: string;
  session_id: string;
  /**
   * The room the telephone was joined into, so the caller's browser can join it too.
   *
   * A translated phone call is a room with a telephone in it. Without joining, the caller
   * is not in their own call: the engine translates a speaker into the room's *other*
   * languages, and a room holding only the phone has none.
   */
  room?: string | null;
  status: string;
  reserved_credits: number;
  price_per_minute: string;
}

export function quoteVoipCall(
  orgId: string,
  body: Partial<VoipDialRequest> & { destination: string },
): Promise<ApiResult<VoipQuote>> {
  return request('POST', `/api/business/organizations/${orgId}/voip/quote`, body);
}

export function dialVoipCall(
  orgId: string,
  body: VoipDialRequest,
): Promise<ApiResult<VoipCallCreated>> {
  return request('POST', `/api/business/organizations/${orgId}/voip/calls`, body);
}

export function getVoipCalls(
  orgId: string,
  opts: { projectId?: string; page?: number; limit?: number } = {},
): Promise<ApiResult<{ calls: VoipCallSummary[]; page: number; limit: number }>> {
  const q = new URLSearchParams();
  if (opts.projectId) q.set('project_id', opts.projectId);
  if (opts.page) q.set('page', String(opts.page));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request('GET', `/api/business/organizations/${orgId}/voip/calls${qs ? `?${qs}` : ''}`);
}

export function getVoipCall(orgId: string, callId: string): Promise<ApiResult<VoipCallDetail>> {
  return request('GET', `/api/business/organizations/${orgId}/voip/calls/${callId}`);
}

export interface VoipVideoInvite {
  /** The link to share. Carries a signed ticket, never the room code itself. */
  url: string;
  expires_at: string;
}

/**
 * Offer the recipient a browser room for video.
 *
 * They are on a telephone, so there is no channel from here to them — the caller is
 * already talking to the person and passes the link on however they like.
 */
export function createVoipVideoInvite(
  orgId: string,
  callId: string,
): Promise<ApiResult<VoipVideoInvite>> {
  return request(
    'POST',
    `/api/business/organizations/${orgId}/voip/calls/${callId}/video-invite`,
    {},
  );
}

export function hangUpVoipCall(orgId: string, callId: string): Promise<ApiResult<unknown>> {
  return request('POST', `/api/business/organizations/${orgId}/voip/calls/${callId}/hangup`);
}

export function getVoipSettings(orgId: string): Promise<ApiResult<VoipSettings>> {
  return request('GET', `/api/business/organizations/${orgId}/voip/settings`);
}

export function saveVoipSettings(
  orgId: string,
  body: Partial<VoipSettings> & { enabled: boolean },
): Promise<ApiResult<VoipSettings>> {
  return request('PUT', `/api/business/organizations/${orgId}/voip/settings`, body);
}

/** One of the organisation's own telephone numbers (spec 0112 R3). */
export interface VoipNumber {
  id: string;
  e164: string;
  country: string;
  label: string | null;
  is_default: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  /** 'pending' | 'verified' | 'rejected'. Only a verified number may be presented. */
  verification_status: string;
}

/**
 * The organisation's numbers, every one of them.
 *
 * Rows that cannot be presented as caller id yet come back too, carrying the state that
 * says so — hiding a number stuck in `pending` from the admin who has to chase it would
 * be the wrong kind of tidy. Deciding which are *usable* is `usableCallerIds` in
 * `scripts/phone-catalogue.ts`, and the server re-checks it on the way out.
 */
export function listVoipNumbers(orgId: string): Promise<ApiResult<{ numbers: VoipNumber[] }>> {
  return request('GET', `/api/business/organizations/${orgId}/voip/numbers`);
}

// --- Contacts (spec 0114) ----------------------------------------------------

export interface VoipContactNumber {
  id?: string;
  e164: string;
  label: string | null;
  /** The language THIS number speaks — not the person's. */
  language: string | null;
  country?: string | null;
  is_primary: boolean;
}

export interface VoipContactSummary {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  notes: string | null;
  tags: string[];
  email: string | null;
}

export interface VoipContactDetail extends VoipContactSummary {
  numbers: VoipContactNumber[];
  projects: { id: string; name: string }[];
}

export interface VoipContactBody {
  name: string;
  company?: string | null;
  role?: string | null;
  notes?: string | null;
  tags?: string[];
  email?: string | null;
  numbers?: Partial<VoipContactNumber>[];
  project_ids?: string[];
}

export interface ContactQuery {
  q?: string;
  projectId?: string;
  tag?: string;
  language?: string;
  page?: number;
  limit?: number;
}

export function listVoipContacts(
  orgId: string,
  opts: ContactQuery = {},
): Promise<ApiResult<{ contacts: VoipContactSummary[]; page: number; limit: number }>> {
  const q = new URLSearchParams();
  if (opts.q) q.set('q', opts.q);
  if (opts.projectId) q.set('project_id', opts.projectId);
  if (opts.tag) q.set('tag', opts.tag);
  if (opts.language) q.set('language', opts.language);
  if (opts.page) q.set('page', String(opts.page));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request('GET', `/api/business/organizations/${orgId}/voip/contacts${qs ? `?${qs}` : ''}`);
}

export function createVoipContact(
  orgId: string,
  body: VoipContactBody,
): Promise<ApiResult<{ id: string }>> {
  return request('POST', `/api/business/organizations/${orgId}/voip/contacts`, body);
}

export function getVoipContact(
  orgId: string,
  contactId: string,
): Promise<ApiResult<VoipContactDetail>> {
  return request('GET', `/api/business/organizations/${orgId}/voip/contacts/${contactId}`);
}

export function updateVoipContact(
  orgId: string,
  contactId: string,
  body: VoipContactBody,
): Promise<ApiResult<unknown>> {
  return request('PATCH', `/api/business/organizations/${orgId}/voip/contacts/${contactId}`, body);
}

export function deleteVoipContact(orgId: string, contactId: string): Promise<ApiResult<unknown>> {
  return request('DELETE', `/api/business/organizations/${orgId}/voip/contacts/${contactId}`);
}

/**
 * Who holds this number? A 404 means nobody, which is normal rather than an error — it is
 * how the call page decides whether to offer to save the number it just dialled.
 */
export function lookupVoipContact(
  orgId: string,
  e164: string,
): Promise<
  ApiResult<{ id: string; name: string; company: string | null; language: string | null }>
> {
  return request(
    'GET',
    `/api/business/organizations/${orgId}/voip/contacts/lookup?e164=${encodeURIComponent(e164)}`,
  );
}

// --- Shared catalogues (public, not org-scoped) ------------------------------

/**
 * One engine as the public catalogue describes it.
 *
 * `rate_per_minute` is the user-facing rate. The raw cost and the markup behind it are
 * never serialized — `engine_info_never_leaks_cost_or_markup` in the server pins that.
 */
export interface EngineInfo {
  id: string;
  display_name: string;
  tier: string;
  description: string;
  rate_per_minute: number;
  input_languages: string[];
  output_languages: string[];
}

export interface LanguageMetaDto {
  code: string;
  native: string;
  english: string;
  region: string;
  rtl: boolean;
  flag: string;
}

/**
 * `GET /api/engines` — which engines exist, what they cost, and the languages each one
 * can take in and emit. Unauthenticated and shared with the call app, so the dialer's
 * tier list cannot drift from the one a user sees in a room.
 */
export function getEngines(): Promise<ApiResult<{ engines: EngineInfo[] }>> {
  return request('GET', '/api/engines');
}

/**
 * `GET /api/languages` — how language codes are named, grouped and ordered.
 *
 * Served from the same embedded `languages.json` the call app reads, and cached an hour,
 * so the phone picker names a language exactly as the room does. A second vocabulary for
 * the same thing is a support ticket waiting to happen.
 */
export function getLanguageCatalogue(): Promise<
  ApiResult<{ languages: LanguageMetaDto[]; regions: string[] }>
> {
  return request('GET', '/api/languages');
}

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
