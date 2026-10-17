import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { BillingRedirectDto, BillingStateDto } from '@silencewatch/shared';
import { Observable } from 'rxjs';

/**
 * The signed-in user's subscription. `state` answers on every instance, with
 * `enabled: false` where there is no billing; the other two exist only where
 * there is.
 */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);

  state(): Observable<BillingStateDto> {
    return this.http.get<BillingStateDto>('/api/v1/billing');
  }

  /** The address of Stripe's payment page for a plan. */
  checkout(plan: string): Observable<BillingRedirectDto> {
    return this.http.post<BillingRedirectDto>('/api/v1/billing/checkout', { plan });
  }

  /** The address of Stripe's customer portal. */
  portal(): Observable<BillingRedirectDto> {
    return this.http.post<BillingRedirectDto>('/api/v1/billing/portal', {});
  }
}
