import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CheckDto,
  CreateCheckRequest,
  IncidentDto,
  PageDto,
  PingDto,
  UpdateCheckRequest,
} from '@silencewatch/shared';
import { Observable } from 'rxjs';
import { toParams } from './query-params';

export interface ChecksQuery extends Record<string, unknown> {
  state?: string;
  environment?: string;
  tag?: string;
  search?: string;
  orphaned?: boolean;
  limit?: number;
  cursor?: string;
}

/** The REST API's checks, with their pings and incidents. */
@Injectable({ providedIn: 'root' })
export class ChecksApi {
  private readonly http = inject(HttpClient);

  /** Every project the caller can see. Used by nothing in the UI: every screen
   *  is scoped to the selected project, so it would show a check from a project
   *  the header is not pointing at. Kept because it is the REST API's own list. */
  list(query: ChecksQuery = {}): Observable<PageDto<CheckDto>> {
    return this.http.get<PageDto<CheckDto>>('/api/v1/checks', { params: toParams(query) });
  }

  listForProject(projectId: string, query: ChecksQuery = {}): Observable<PageDto<CheckDto>> {
    return this.http.get<PageDto<CheckDto>>(`/api/v1/projects/${projectId}/checks`, {
      params: toParams(query),
    });
  }

  get(checkId: string): Observable<CheckDto> {
    return this.http.get<CheckDto>(`/api/v1/checks/${checkId}`);
  }

  create(projectId: string, request: CreateCheckRequest): Observable<CheckDto> {
    return this.http.post<CheckDto>(`/api/v1/projects/${projectId}/checks`, request);
  }

  update(checkId: string, request: UpdateCheckRequest): Observable<CheckDto> {
    return this.http.patch<CheckDto>(`/api/v1/checks/${checkId}`, request);
  }

  /** Issues a new ping URL. The old one stops working immediately. */
  rotatePingKey(checkId: string): Observable<CheckDto> {
    return this.http.post<CheckDto>(`/api/v1/checks/${checkId}/rotate-ping-key`, {});
  }

  delete(checkId: string): Observable<void> {
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
}
