import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
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
import { describeSchedule } from '../../shared/schedule';

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
            <sw-state-chip [state]="current.state" size="lg" />
            <h1>{{ current.name }}</h1>
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
              <button mat-menu-item (click)="rotate(current)">
                <sw-icon name="copy" />
                Rotate ping URL
              </button>
              <button mat-menu-item (click)="remove(current)">
                <sw-icon name="delete" />
                Delete check
              </button>
            </mat-menu>
          </div>
        </header>

        <!-- First on the page because it is the first thing anyone needs: pasting
             this into a crontab is the entire setup. -->
        <section class="sw-card ping">
          <div class="ping-head">
            <span class="sw-label">Ping URL</span>
            <span class="sw-muted ping-hint">call it when the job finishes</span>
            @if (current.pingKeyRotatedAt) {
              <span class="sw-tag rotated">rotated {{ current.pingKeyRotatedAt | swRelativeTime }}</span>
            }
          </div>
          <div class="ping-row">
            <code class="sw-mono url">{{ current.pingUrl }}</code>
            <button
              mat-flat-button
              class="copy"
              (click)="copy(current.pingUrl)"
              matTooltip="Copy to clipboard"
              aria-label="Copy ping URL"
            >
              <sw-icon name="copy" [size]="18" />
              Copy
            </button>
          </div>
          <pre class="sw-mono snippet"><span class="prompt">$</span> curl -fsS -m 10 --retry 3 {{ current.pingUrl }}</pre>
        </section>

        <div class="facts">
          <div class="fact">
            <span class="sw-label">Schedule</span>
            <strong class="sw-mono">{{ schedule(current) }}</strong>
          </div>
          <div class="fact">
            <span class="sw-label">Grace period</span>
            <strong>{{ current.graceSeconds }}s</strong>
          </div>
          <div class="fact">
            <span class="sw-label">Last ping</span>
            <strong [matTooltip]="current.lastPingAt ?? ''">{{ current.lastPingAt | swRelativeTime }}</strong>
          </div>
          <div class="fact">
            <span class="sw-label">Expected by</span>
            <strong [matTooltip]="current.nextDueAt ?? ''">{{ current.nextDueAt | swRelativeTime }}</strong>
          </div>
          <div class="fact">
            <span class="sw-label">Last duration</span>
            <strong>{{ current.lastDurationMs | swDuration }}</strong>
          </div>
          <div class="fact">
            <span class="sw-label">Environment</span>
            <strong>{{ current.environment ?? '—' }}</strong>
          </div>
        </div>

        @if (current.key) {
          <p class="key sw-muted">
            Declared automatically as <code class="sw-mono">{{ current.key }}</code>
            @if (current.orphanedAt) {
              — the client stopped reporting it {{ current.orphanedAt | swRelativeTime }}. History is kept
              until you delete it.
            }
          </p>
        }

        <mat-tab-group class="tabs" animationDuration="120ms" [mat-stretch-tabs]="false">
          <mat-tab label="Recent pings">
            @if (pings().length === 0) {
              <div class="sw-empty">
                <h2>No ping received yet</h2>
                <p>The first call to the ping URL above will appear here within seconds.</p>
              </div>
            } @else {
              <div class="sw-scroll-x panel">
                <table class="sw-table">
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
                        <td class="sw-num">{{ ping.durationMs | swDuration }}</td>
                        <td class="sw-num">{{ ping.exitCode ?? '—' }}</td>
                        <td class="sw-mono sw-muted">{{ ping.sourceIp ?? '—' }}</td>
                        <td class="body sw-mono sw-muted">{{ ping.body ?? '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </mat-tab>

          <mat-tab label="Incidents">
            @if (incidents().length === 0) {
              <div class="sw-empty">
                <h2>No incident</h2>
                <p>This job has never gone quiet.</p>
              </div>
            } @else {
              <div class="sw-scroll-x panel">
                <table class="sw-table">
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
                      <tr [class.ongoing]="incident.resolvedAt === null">
                        <td [matTooltip]="incident.startedAt">{{ incident.startedAt | swRelativeTime }}</td>
                        <td>
                          @if (incident.resolvedAt) {
                            {{ incident.resolvedAt | swRelativeTime }}
                          } @else {
                            <span class="ongoing-tag">ongoing</span>
                          }
                        </td>
                        <td class="sw-num">{{ outage(incident) | swDuration }}</td>
                        <td class="sw-num">{{ incident.notificationsSent }}</td>
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
      gap: 4px;
      margin-bottom: 18px;
      padding: 4px 10px 4px 6px;
      border-radius: var(--sw-radius-sm);
      color: var(--sw-text-muted);
      font-size: 0.8125rem;
      font-weight: 500;
      transition:
        background-color 120ms ease,
        color 120ms ease;
    }

    .back:hover {
      background: var(--sw-surface-3);
      color: var(--sw-text);
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

    /* ------------------------------------------------------------ ping URL --- */

    .ping {
      padding: 18px 20px;
      margin-bottom: 22px;
    }

    .ping-head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }

    .rotated {
      align-self: center;
    }

    .ping-hint {
      font-size: 0.75rem;
    }

    .ping-row {
      display: flex;
      align-items: stretch;
      gap: 10px;
      margin-top: 10px;
    }

    .url {
      display: flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius);
      background: var(--sw-surface-2);
      overflow-x: auto;
      white-space: nowrap;
      color: var(--sw-text);
    }

    .copy {
      flex: none;
      gap: 6px;
    }

    .snippet {
      display: block;
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: var(--sw-radius);
      background: var(--sw-surface-3);
      color: var(--sw-text-muted);
      font-size: 0.75rem;
      overflow-x: auto;
      white-space: pre;
    }

    .prompt {
      color: var(--sw-text-subtle);
      user-select: none;
    }

    /* --------------------------------------------------------------- facts --- */

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1px;
      margin-bottom: 20px;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius-lg);
      background: var(--sw-border);
      overflow: hidden;
    }

    .fact {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 16px;
      background: var(--sw-surface);
    }

    .fact strong {
      font-size: 0.9375rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .key {
      margin: 0 0 20px;
      font-size: 0.8125rem;
    }

    .key code {
      padding: 1px 6px;
      border-radius: var(--sw-radius-sm);
      background: var(--sw-surface-3);
    }

    /* --------------------------------------------------------------- tabs --- */

    .tabs {
      margin-top: 4px;
    }

    .panel {
      margin-top: 16px;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius-lg);
      background: var(--sw-surface);
    }

    .kind {
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .kind-success { color: var(--sw-up); }
    .kind-fail { color: var(--sw-down); }
    .kind-start { color: var(--sw-new); }

    .ongoing-tag {
      color: var(--sw-down);
      font-weight: 600;
    }

    tr.ongoing td:first-child {
      box-shadow: inset 3px 0 0 var(--sw-down);
    }

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

  /**
   * Issues a new ping URL.
   *
   * Confirmed in words rather than behind an "are you sure", because the
   * consequence is specific and easy to miss: every job still calling the old
   * URL goes quiet, and this product turns quiet into an alert.
   */
  protected rotate(check: CheckDto): void {
    const confirmed = window.confirm(
      `Issue a new ping URL for "${check.name}"?\n\n` +
        'The current URL stops working immediately. Any job still calling it will be reported ' +
        'as down until you update it. History and incidents are kept.',
    );
    if (!confirmed) return;

    this.api.rotatePingKey(check.id).subscribe({
      next: (updated) => {
        this.check.set(updated);
        this.snackBar.open('New ping URL issued — update your jobs', 'OK', { duration: 6000 });
      },
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, 'Could not rotate the ping URL.')),
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

  protected readonly schedule = describeSchedule;

  protected outage(incident: IncidentDto): number {
    const end = incident.resolvedAt === null ? Date.now() : Date.parse(incident.resolvedAt);
    return end - Date.parse(incident.startedAt);
  }
}
