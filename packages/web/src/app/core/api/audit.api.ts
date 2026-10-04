import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuditEventDto, PageDto } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/** The REST API's audit trail: the project's events, and the signed-in account's own. */
@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);

  listForProject(projectId: string, limit = 50): Observable<PageDto<AuditEventDto>> {
    return this.http.get<PageDto<AuditEventDto>>(
      `/api/v1/projects/${projectId}/audit?limit=${limit}`,
    );
  }

  listForAccount(limit = 50): Observable<PageDto<AuditEventDto>> {
    return this.http.get<PageDto<AuditEventDto>>(`/api/v1/account/audit?limit=${limit}`);
  }
}
