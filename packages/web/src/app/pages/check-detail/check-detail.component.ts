import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import type { CheckDto, IncidentDto, PingDto } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StateChipComponent } from '../../shared/state-chip.component';
import { CheckFormDialog } from '../checks/check-form.dialog';
import { IconComponent } from '../../shared/icon.component';

const REFRESH_INTERVAL_MS = 15_000;

/**
 * One check: its ping URL, what it did recently, and what broke when.
 *
 * The ping URL is the first thing shown because it is the first thing anyone
 * needs — pasting it into a crontab is the whole setup.
 */
@Component({
  selector: 'sw-check-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTabsModule,
    MatTooltipModule,
    StateChipComponent,
    RelativeTimePipe,
    DurationPipe,
  ],
  template: `
    <div class="sw-page">
      <a routerLink="/checks" class="back">
        <sw-icon name="back" />
        All checks
      </a>

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      @if (check(); as current) {
        <header class="sw-page-header">
          <div class="title">
            <h1>{{ current.name }}</h1>
            <sw-state-chip [state]="current.state" />
          </div>

          <div class="actions">
            <button mat-stroked-button (click)="edit(current)">
              <sw-icon name="edit" />
              Edit
            </button>
            <button mat-stroked-button (click)="togglePause(current)">
              <sw-icon [name]="current.state === 'PAUSED' ? 'play' : 'pause'" />
              {{ current.state === 'PAUSED' ? 'Resume' : 'Pause' }}
            </button>
            <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="More actions">
              <sw-icon name="more" />
            </button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="remove(current)">
                <sw-icon name="delete" />
                Delete check
              </button>
            </mat-menu>
          </div>
        </header>

        <mat-card appearance="outlined" class="ping">
          <mat-card-content>
            <div class="ping-label sw-muted">Ping URL — call it when the job runs</div>
            <div class="ping-row">
              <code class="sw-mono url">{{ current.pingUrl }}</code>
              <button mat-icon-button (click)="copy(current.pingUrl)" matTooltip="Copy" aria-label="Copy ping URL">
                <sw-icon name="copy" />
              </button>
            </div>
            <div class="hint sw-muted sw-mono">
              curl -fsS -m 10 --retry 3 {{ current.pingUrl }}
            </div>
          </mat-card-content>
        </mat-card>

        <div class="facts">
          <div class="fact">
            <span class="sw-muted">Schedule</span>
            <strong class="sw-mono">{{ schedule(current) }}</strong>
          </div>
          <div class="fact">
            <span class="sw-muted">Grace period</span>
            <strong>{{ current.graceSeconds }}s</strong>
          </div>
          <div class="fact">
            <span class="sw-muted">Last ping</span>
            <strong [matTooltip]="current.lastPingAt ?? ''">{{ current.lastPingAt | swRelativeTime }}</strong>
          </div>
          <div class="fact">
            <span class="sw-muted">Expected by</span>
            <strong [matTooltip]="current.nextDueAt ?? ''">{{ current.nextDueAt | swRelativeTime }}</strong>
          </div>
          <div class="fact">
            <span class="sw-muted">Last duration</span>
            <strong>{{ current.lastDurationMs | swDuration }}</strong>
          </div>
          <div class="fact">
            <span class="sw-muted">Environment</span>
            <strong>{{ current.environment ?? '—' }}</strong>
          </div>
        </div>

        @if (current.key) {
          <p class="sw-muted key">
            Declared automatically as <code class="sw-mono">{{ current.key }}</code>
            @if (current.orphanedAt) {
              — the client stopped reporting it {{ current.orphanedAt | swRelativeTime }}. History is
              kept until you delete it.
            }
          </p>
        }

        <mat-tab-group class="tabs">
          <mat-tab label="Recent pings">
            @if (pings().length === 0) {
              <p class="sw-empty">No ping received yet.</p>
            } @else {
              <div class="sw-scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Exit</th>
                      <th scope="col">Source</th>
                      <th scope="col">Body</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (ping of pings(); track ping.id) {
                      <tr>
                        <td [matTooltip]="ping.receivedAt">{{ ping.receivedAt | swRelativeTime }}</td>
                        <td>
                          <span class="kind" [class]="'kind-' + ping.kind">{{ ping.kind }}</span>
                        </td>
                        <td>{{ ping.durationMs | swDuration }}</td>
                        <td>{{ ping.exitCode ?? '—' }}</td>
                        <td class="sw-mono">{{ ping.sourceIp ?? '—' }}</td>
                        <td class="body sw-mono">{{ ping.body ?? '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </mat-tab>

          <mat-tab label="Incidents">
            @if (incidents().length === 0) {
              <p class="sw-empty">No incident. This job has never gone quiet.</p>
            } @else {
              <div class="sw-scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Started</th>
                      <th scope="col">Resolved</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Alerts sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (incident of incidents(); track incident.id) {
                      <tr>
                        <td [matTooltip]="incident.startedAt">{{ incident.startedAt | swRelativeTime }}</td>
                        <td>
                          {{ incident.resolvedAt ? (incident.resolvedAt | swRelativeTime) : 'ongoing' }}
                        </td>
                        <td>{{ outage(incident) | swDuration }}</td>
                        <td>{{ incident.notificationsSent }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </mat-tab>
        </mat-tab-group>
      } @else if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
    </div>
  `,
  styles: `
    .back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
      text-decoration: none;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .ping {
      margin-bottom: 20px;
    }

    .ping-label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ping-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }

    .url {
      flex: 1 1 auto;
      overflow-x: auto;
      white-space: nowrap;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--mat-sys-surface-container-highest);
    }

    .hint {
      margin-top: 8px;
      font-size: 0.78rem;
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }

    .fact {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 0.9rem;
    }

    .fact span {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .key {
      font-size: 0.85rem;
    }

    .tabs {
      margin-top: 8px;
    }

    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      font-size: 0.875rem;
    }

    .kind {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .kind-success { color: var(--sw-state-up); }
    .kind-fail { color: var(--sw-state-down); }
    .kind-start { color: var(--sw-state-new); }

    .body {
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class CheckDetailComponent implements OnDestroy {
  /** Bound from the route parameter by withComponentInputBinding(). */
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly projects = inject(ProjectStore);

  protected readonly check = signal<CheckDto | null>(null);
  protected readonly pings = signal<PingDto[]>([]);
  protected readonly incidents = signal<IncidentDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly timer = setInterval(() => this.load(true), REFRESH_INTERVAL_MS);

  constructor() {
    this.projects.load();
    effect(() => {
      // Re-runs when the route id changes, including navigation between checks.
      this.id();
      this.load();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected load(quiet = false): void {
    const checkId = this.id();
    if (!quiet) this.loading.set(true);

    this.api.getCheck(checkId).subscribe({
      next: (check) => {
        this.check.set(check);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (failure: unknown) => {
        this.loading.set(false);
        this.error.set(errorMessage(failure, 'Could not load this check.'));
      },
    });

    this.api.listPings(checkId, 50).subscribe({ next: (page) => this.pings.set(page.items) });
    this.api.listIncidents(checkId, 20).subscribe({ next: (page) => this.incidents.set(page.items) });
  }

  protected edit(check: CheckDto): void {
    this.dialog
      .open(CheckFormDialog, { data: { projectId: check.projectId, check } })
      .afterClosed()
      .subscribe((updated?: CheckDto) => {
        if (updated) this.check.set(updated);
      });
  }

  protected togglePause(check: CheckDto): void {
    const paused = check.state !== 'PAUSED';
    this.api.updateCheck(check.id, { paused }).subscribe({
      next: (updated) => {
        this.check.set(updated);
        this.snackBar.open(paused ? 'Check paused' : 'Check resumed', 'OK', { duration: 3000 });
      },
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not update the check.')),
    });
  }

  protected remove(check: CheckDto): void {
    // Deleting destroys the history, so make the user say the name.
    const confirmed = window.confirm(
      `Delete "${check.name}"? Its pings and incidents are destroyed with it. This cannot be undone.`,
    );
    if (!confirmed) return;

    this.api.deleteCheck(check.id).subscribe({
      next: () => {
        this.snackBar.open('Check deleted', 'OK', { duration: 3000 });
        void this.router.navigate(['/checks']);
      },
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not delete the check.')),
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open('Ping URL copied', 'OK', { duration: 2000 }))
      .catch(() => this.snackBar.open('Could not copy — select the URL manually', 'OK', { duration: 4000 }));
  }

  protected schedule(check: CheckDto): string {
    return check.scheduleType === 'cron'
      ? `${check.cronExpression} (${check.timezone})`
      : `every ${check.periodSeconds}s`;
  }

  protected outage(incident: IncidentDto): number {
    const end = incident.resolvedAt === null ? Date.now() : Date.parse(incident.resolvedAt);
    return end - Date.parse(incident.startedAt);
  }
}
