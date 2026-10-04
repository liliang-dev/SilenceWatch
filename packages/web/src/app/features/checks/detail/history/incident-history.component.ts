import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { IncidentDto } from '@silencewatch/shared';
import { I18n } from '../../../../core/i18n/i18n.service';
import { DataTable, PAGE_SIZES } from '../../../../shared/data-table';
import { IconComponent } from '../../../../shared/icon.component';
import { PAGINATOR_INTL } from '../../../../shared/paginator-intl';
import { DurationPipe, RelativeTimePipe } from '../../../../shared/relative-time.pipe';
import { incidentRules, outageMs } from './history-tables';

/** A check's incidents: filter by status, search, sort, page. The page hands it the rows. */
@Component({
  selector: 'sw-incident-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DurationPipe,
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
  templateUrl: './incident-history.component.html',
  styleUrls: ['./history.scss', './incident-history.component.scss'],
})
export class IncidentHistoryComponent {
  readonly rows = input.required<readonly IncidentDto[]>();
  /** True when the log is longer than one request returns. */
  readonly truncated = input(false);

  protected readonly t = inject(I18n).t;
  protected readonly incidents = new DataTable<IncidentDto>(incidentRules(this.t));
  protected readonly incidentFilter = signal('');
  protected readonly incidentColumns = ['startedAt', 'resolvedAt', 'duration', 'notificationsSent'];
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly outage = outageMs;

  constructor() {
    effect(() => this.incidents.setRows([...this.rows()]));
  }

  protected filterIncidentsBy(status: string): void {
    this.incidentFilter.set(status);
    this.incidents.setFilter((incident) => {
      if (status === 'ongoing') return incident.resolvedAt === null;
      if (status === 'resolved') return incident.resolvedAt !== null;
      return true;
    });
  }
}
