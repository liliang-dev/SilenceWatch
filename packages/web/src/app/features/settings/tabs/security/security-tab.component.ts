import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { AuditEventDto } from '@silencewatch/shared';
import { catchError, forkJoin, of } from 'rxjs';
import { AuditApi } from '../../../../core/api/audit.api';
import { I18n } from '../../../../core/i18n/i18n.service';
import { ProjectStore } from '../../../../core/project.store';
import { DataTable, PAGE_SIZES } from '../../../../shared/data-table';
import { IconComponent } from '../../../../shared/icon.component';
import { PAGINATOR_INTL } from '../../../../shared/paginator-intl';
import { RelativeTimePipe } from '../../../../shared/relative-time.pipe';
import { auditLabel, auditRules, auditScope, isFailure } from './audit-table';

/** The audit endpoints' own maximum, from each of the two lists. */
const AUDIT_LIMIT = 200;

/**
 * The record of what has been done to the account and the project.
 *
 * Read-only, and admin-only on the server. The trail carries addresses and user
 * agents; it is for the people already trusted with the project's keys, not for
 * everyone in it.
 */
@Component({
  selector: 'sw-security-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IconComponent,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RelativeTimePipe,
  ],
  providers: [PAGINATOR_INTL],
  templateUrl: './security-tab.component.html',
  styleUrls: ['../../section.scss', './security-tab.component.scss'],
})
export class SecurityTabComponent {
  private readonly api = inject(AuditApi);
  private readonly projects = inject(ProjectStore);
  protected readonly t = inject(I18n).t;

  protected readonly audit = new DataTable<AuditEventDto>(auditRules(this.t));
  protected readonly auditFilter = signal('');
  protected readonly auditColumns = ['occurredAt', 'action', 'actor', 'target', 'ip'];
  protected readonly pageSizes = PAGE_SIZES;

  protected readonly label = (action: string): string => auditLabel(action, this.t);
  protected readonly isFailure = isFailure;

  constructor() {
    effect(() => {
      const project = this.projects.selected();
      if (project !== null) this.load(project.id);
    });
  }

  /**
   * Account events and project events in one list.
   *
   * They live in separate endpoints because they have separate access rules —
   * your own sign-ins are yours, the project's key changes need admin — but a
   * reader looking for "what happened" should not have to know that.
   *
   * Both are asked for the server's maximum. The old page took 40 of each and
   * showed the 60 most recent, which meant a search for a sign-in from last
   * month could only ever fail — and fail silently, looking like it had not
   * happened.
   */
  private load(projectId: string): void {
    forkJoin({
      account: this.api.listForAccount(AUDIT_LIMIT),
      project: this.api
        .listForProject(projectId, AUDIT_LIMIT)
        // A member without the admin role simply sees fewer rows, rather than
        // an error on a page that is otherwise about their own account.
        .pipe(catchError(() => of({ items: [] as AuditEventDto[], nextCursor: null }))),
    }).subscribe({
      next: ({ account, project }) => {
        const merged = [...account.items, ...project.items].sort((a, b) =>
          b.occurredAt.localeCompare(a.occurredAt),
        );
        this.audit.setRows(merged);
      },
      error: () => this.audit.setRows([]),
    });
  }

  protected filterAuditBy(scope: string): void {
    this.auditFilter.set(scope);
    this.audit.setFilter((event) => {
      if (scope === 'failures') return isFailure(event.action);
      if (scope === '') return true;
      return auditScope(event) === scope;
    });
  }
}
