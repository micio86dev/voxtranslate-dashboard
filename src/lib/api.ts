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
