import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ApiKeyDto,
  AuditEventDto,
  CheckDto,
  CreateApiKeyRequest,
  CreateCheckRequest,
  CreateChannelRequest,
  CreatedApiKeyDto,
  IncidentDto,
  NotificationChannelDto,
  PageDto,
  PingDto,
  ProjectDto,
  UpdateProjectRequest,
  UpdateCheckRequest,
} from '@silencewatch/shared';
import { Observable } from 'rxjs';

export interface ChecksQuery extends Record<string, unknown> {
  state?: string;
  environment?: string;
  tag?: string;
  search?: string;
  orphaned?: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * The REST API, in one place.
 *
 * Request and response types come from `@silencewatch/shared` — the same
 * definitions the server validates with — so a contract change breaks the build
 * here instead of failing at runtime in front of a user.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /* ------------------------------------------------------------- projects --- */

  listProjects(): Observable<ProjectDto[]> {
    return this.http.get<ProjectDto[]>('/api/v1/projects');
  }

  createProject(name: string): Observable<ProjectDto> {
    return this.http.post<ProjectDto>('/api/v1/projects', { name });
  }

  updateProject(projectId: string, patch: UpdateProjectRequest): Observable<ProjectDto> {
    return this.http.patch<ProjectDto>(`/api/v1/projects/${projectId}`, patch);
  }

  /** 409 when it is the account's last project — the server, not the browser,
   *  is what guarantees an account always has one. */
  deleteProject(projectId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}`);
  }

  /* --------------------------------------------------------------- checks --- */

  listChecks(query: ChecksQuery = {}): Observable<PageDto<CheckDto>> {
    return this.http.get<PageDto<CheckDto>>('/api/v1/checks', { params: toParams(query) });
  }

  getCheck(checkId: string): Observable<CheckDto> {
    return this.http.get<CheckDto>(`/api/v1/checks/${checkId}`);
  }

  createCheck(projectId: string, request: CreateCheckRequest): Observable<CheckDto> {
    return this.http.post<CheckDto>(`/api/v1/projects/${projectId}/checks`, request);
  }

  updateCheck(checkId: string, request: UpdateCheckRequest): Observable<CheckDto> {
    return this.http.patch<CheckDto>(`/api/v1/checks/${checkId}`, request);
  }

  /** Issues a new ping URL. The old one stops working immediately. */
  rotatePingKey(checkId: string): Observable<CheckDto> {
    return this.http.post<CheckDto>(`/api/v1/checks/${checkId}/rotate-ping-key`, {});
  }

  listProjectAudit(projectId: string, limit = 50): Observable<PageDto<AuditEventDto>> {
    return this.http.get<PageDto<AuditEventDto>>(
      `/api/v1/projects/${projectId}/audit?limit=${limit}`,
    );
  }

  listAccountAudit(limit = 50): Observable<PageDto<AuditEventDto>> {
    return this.http.get<PageDto<AuditEventDto>>(`/api/v1/account/audit?limit=${limit}`);
  }

  deleteCheck(checkId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/checks/${checkId}`);
  }

  listPings(checkId: string, limit = 50): Observable<PageDto<PingDto>> {
    return this.http.get<PageDto<PingDto>>(`/api/v1/checks/${checkId}/pings`, {
      params: toParams({ limit }),
    });
  }

  listIncidents(checkId: string, limit = 20): Observable<PageDto<IncidentDto>> {
    return this.http.get<PageDto<IncidentDto>>(`/api/v1/checks/${checkId}/incidents`, {
      params: toParams({ limit }),
    });
  }

  /* ------------------------------------------------------------- channels --- */

  listChannels(projectId: string): Observable<NotificationChannelDto[]> {
    return this.http.get<NotificationChannelDto[]>(`/api/v1/projects/${projectId}/channels`);
  }

  createChannel(
    projectId: string,
    request: CreateChannelRequest,
  ): Observable<NotificationChannelDto> {
    return this.http.post<NotificationChannelDto>(`/api/v1/projects/${projectId}/channels`, request);
  }

  updateChannel(
    projectId: string,
    channelId: string,
    request: { enabled?: boolean; name?: string },
  ): Observable<NotificationChannelDto> {
    return this.http.patch<NotificationChannelDto>(
      `/api/v1/projects/${projectId}/channels/${channelId}`,
      request,
    );
  }

  deleteChannel(projectId: string, channelId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}/channels/${channelId}`);
  }

  testChannel(projectId: string, channelId: string): Observable<void> {
    return this.http.post<void>(`/api/v1/projects/${projectId}/channels/${channelId}/test`, {});
  }

  /* ------------------------------------------------------------- api keys --- */

  listApiKeys(projectId: string): Observable<ApiKeyDto[]> {
    return this.http.get<ApiKeyDto[]>(`/api/v1/projects/${projectId}/api-keys`);
  }

  createApiKey(projectId: string, request: CreateApiKeyRequest): Observable<CreatedApiKeyDto> {
    return this.http.post<CreatedApiKeyDto>(`/api/v1/projects/${projectId}/api-keys`, request);
  }

  revokeApiKey(projectId: string, apiKeyId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}/api-keys/${apiKeyId}`);
  }
}

function toParams(query: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
