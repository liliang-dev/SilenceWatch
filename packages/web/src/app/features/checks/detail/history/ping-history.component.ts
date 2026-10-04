import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PingDto } from '@silencewatch/shared';
import { I18n } from '../../../../core/i18n/i18n.service';
import { DataTable, PAGE_SIZES } from '../../../../shared/data-table';
import { IconComponent } from '../../../../shared/icon.component';
import { PAGINATOR_INTL } from '../../../../shared/paginator-intl';
import { DurationPipe, RelativeTimePipe } from '../../../../shared/relative-time.pipe';
import { kindWord, pingRules } from './history-tables';

/** A check's recent pings: filter by kind, search, sort, page. The page hands it the rows. */
@Component({
  selector: 'sw-ping-history',
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
  templateUrl: './ping-history.component.html',
  styleUrls: ['./history.scss', './ping-history.component.scss'],
})
export class PingHistoryComponent {
  readonly rows = input.required<readonly PingDto[]>();
  /** True when the log is longer than one request returns. */
  readonly truncated = input(false);

  protected readonly t = inject(I18n).t;
  protected readonly pings = new DataTable<PingDto>(pingRules(this.t));
  protected readonly kindFilter = signal('');
  protected readonly pingColumns = [
    'receivedAt',
    'kind',
    'durationMs',
    'exitCode',
    'sourceIp',
    'body',
  ];
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly kindLabel = (ping: PingDto): string => kindWord(ping, this.t);

  constructor() {
    effect(() => this.pings.setRows([...this.rows()]));
  }

  protected filterPingsBy(kind: string): void {
    this.kindFilter.set(kind);
    this.pings.setFilter((ping) => kind === '' || ping.kind === kind);
  }
}
