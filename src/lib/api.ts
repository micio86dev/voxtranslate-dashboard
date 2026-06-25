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
