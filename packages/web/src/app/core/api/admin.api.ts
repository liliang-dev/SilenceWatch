import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AdminStatsDto } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/** The administrator's figures. The server answers 404 to anyone else. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  stats(): Observable<AdminStatsDto> {
    return this.http.get<AdminStatsDto>('/api/v1/admin/stats');
  }
}
