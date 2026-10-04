import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ApiKeyDto, CreateApiKeyRequest, CreatedApiKeyDto } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/** The REST API's project keys. The secret is returned once, by `create`. */
@Injectable({ providedIn: 'root' })
export class ApiKeysApi {
  private readonly http = inject(HttpClient);

  list(projectId: string): Observable<ApiKeyDto[]> {
    return this.http.get<ApiKeyDto[]>(`/api/v1/projects/${projectId}/api-keys`);
  }

  create(projectId: string, request: CreateApiKeyRequest): Observable<CreatedApiKeyDto> {
    return this.http.post<CreatedApiKeyDto>(`/api/v1/projects/${projectId}/api-keys`, request);
  }

  revoke(projectId: string, apiKeyId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}/api-keys/${apiKeyId}`);
  }
}
