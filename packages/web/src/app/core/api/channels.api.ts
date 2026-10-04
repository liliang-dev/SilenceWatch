import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreateChannelRequest, NotificationChannelDto } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/** The REST API's notification channels. */
@Injectable({ providedIn: 'root' })
export class ChannelsApi {
  private readonly http = inject(HttpClient);

  list(projectId: string): Observable<NotificationChannelDto[]> {
    return this.http.get<NotificationChannelDto[]>(`/api/v1/projects/${projectId}/channels`);
  }

  create(projectId: string, request: CreateChannelRequest): Observable<NotificationChannelDto> {
    return this.http.post<NotificationChannelDto>(`/api/v1/projects/${projectId}/channels`, request);
  }

  update(
    projectId: string,
    channelId: string,
    request: { enabled?: boolean; name?: string },
  ): Observable<NotificationChannelDto> {
    return this.http.patch<NotificationChannelDto>(
      `/api/v1/projects/${projectId}/channels/${channelId}`,
      request,
    );
  }

  delete(projectId: string, channelId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectId}/channels/${channelId}`);
  }

  test(projectId: string, channelId: string): Observable<void> {
    return this.http.post<void>(`/api/v1/projects/${projectId}/channels/${channelId}/test`, {});
  }
}
