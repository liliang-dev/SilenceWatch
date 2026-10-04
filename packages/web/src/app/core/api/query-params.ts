import { HttpParams } from '@angular/common/http';

/** Query-string parameters, leaving out anything unset or empty. */
export function toParams(query: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
