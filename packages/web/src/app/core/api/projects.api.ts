import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ProjectDto, UpdateProjectRequest } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/**
 * The REST API's projects, with the other `*.api.ts` files: one class per
 * resource. Request and response types come from `@silencewatch/shared` — the
 * same definitions the server validates with — so a contract change breaks the
 * build here instead of failing at runtime in front of a user.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<ProjectDto[]> {
    return this.http.get<ProjectDto[]>('/api/v1/projects');
  }

  create(name: string): Observable<ProjectDto> {
    return this.http.post<ProjectDto>('/api/v1/projects', { name });
  }

  update(projectId: string, patch: UpdateProjectRequest): Observable<ProjectDto> {
    return this.http.patch<ProjectDto>(`/api/v1/projects/${projectId}`, patch);
  }

  /** 409 when it is the account's last project — the server, not the browser,
   *  is what guarantees an account always has one. */
  delete(projectId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}`);
  }
}
