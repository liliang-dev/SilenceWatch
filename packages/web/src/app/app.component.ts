import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ProjectStore } from './core/project.store';
import { IconComponent } from './shared/icon.component';

/**
 * Application shell: one bar, the project being viewed, and three destinations.
 *
 * A monitoring tool is opened to answer one question — "is anything broken?" —
 * so the chrome stays quiet and unsaturated. The one exception is the count of
 * down checks on the project switcher: if something is broken in a project you
 * are not currently looking at, the shell is the only place that can say so.
 */
@Component({
  selector: 'sw-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatMenuModule],
  template: `
    @if (auth.isAuthenticated()) {
      <header class="bar">
        <div class="bar-inner">
          <a routerLink="/checks" class="brand" aria-label="SilenceWatch home">
            <span class="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path
                  d="M2 12h4l2.5-6.5L13 18l2.5-6H22"
                  stroke="currentColor"
                  stroke-width="2.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="wordmark">Silence<span class="wordmark-accent">Watch</span></span>
          </a>

          <nav class="nav" aria-label="Main">
            <a routerLink="/checks" routerLinkActive="active">Checks</a>
            <a routerLink="/channels" routerLinkActive="active">Alerting</a>
            <a routerLink="/settings" routerLinkActive="active">Settings</a>
          </nav>

          <span class="spacer"></span>

          @if (projects.all().length > 0) {
            <button type="button" class="switcher" [matMenuTriggerFor]="projectMenu">
              <span class="switcher-label sw-label">Project</span>
              <span class="switcher-name">{{ selectedName() }}</span>
              @if (downCount() > 0) {
                <span class="down-badge" [attr.aria-label]="downCount() + ' checks down'">{{ downCount() }}</span>
              }
              <sw-icon name="expand" [size]="18" class="switcher-caret" />
            </button>
            <mat-menu #projectMenu="matMenu" class="sw-menu">
              @for (project of projects.all(); track project.id) {
                <button mat-menu-item (click)="projects.select(project.id)">
                  <span class="menu-project">
                    <span class="menu-project-name">{{ project.name }}</span>
                    @if (project.downCount) {
                      <span class="menu-project-down">{{ project.downCount }} down</span>
                    }
                  </span>
                </button>
              }
            </mat-menu>
          }

          <button type="button" class="avatar" [matMenuTriggerFor]="userMenu" aria-label="Account">
            {{ initials() }}
          </button>
          <mat-menu #userMenu="matMenu" class="sw-menu">
            <div class="menu-email">{{ auth.user()?.email }}</div>
            <button mat-menu-item routerLink="/settings">Settings</button>
            <button mat-menu-item (click)="auth.logout()">Sign out</button>
          </mat-menu>
        </div>
      </header>
    }

    <router-outlet />
  `,
  styles: `
    .bar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: color-mix(in srgb, var(--sw-surface) 82%, transparent);
      backdrop-filter: saturate(180%) blur(12px);
      border-bottom: 1px solid var(--sw-border);
    }

    .bar-inner {
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 1120px;
      height: 56px;
      margin: 0 auto;
      padding: 0 20px;
    }

    /* --- brand ------------------------------------------------------------ */

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-right: 12px;
      color: var(--sw-text);
      text-decoration: none;
      white-space: nowrap;
    }

    .brand:hover {
      text-decoration: none;
    }

    /* The trace of a heartbeat, which is the entire product in one glyph. */
    .mark {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      flex: none;
      border-radius: 8px;
      color: #fff;
      background: linear-gradient(145deg, var(--sw-accent), color-mix(in srgb, var(--sw-accent) 55%, #7c3aed));
      box-shadow: var(--sw-shadow-sm);
    }

    .wordmark {
      font-size: 0.9375rem;
      font-weight: 600;
      letter-spacing: -0.015em;
    }

    .wordmark-accent {
      color: var(--sw-text-muted);
      font-weight: 500;
    }

    /* --- navigation ------------------------------------------------------- */

    .nav {
      display: flex;
      gap: 2px;
    }

    .nav a {
      padding: 6px 12px;
      border-radius: var(--sw-radius-sm);
      color: var(--sw-text-muted);
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      transition:
        background-color 120ms ease,
        color 120ms ease;
    }

    .nav a:hover {
      background: var(--sw-surface-3);
      color: var(--sw-text);
      text-decoration: none;
    }

    .nav a.active {
      background: var(--sw-accent-soft);
      color: var(--sw-accent);
      font-weight: 600;
    }

    .spacer {
      flex: 1 1 auto;
    }

    /* --- project switcher ------------------------------------------------- */

    .switcher {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      max-width: 260px;
      padding: 5px 8px 5px 11px;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius-sm);
      background: var(--sw-surface);
      color: var(--sw-text);
      font: inherit;
      cursor: pointer;
      transition: border-color 120ms ease;
    }

    .switcher:hover {
      border-color: var(--sw-border-strong);
    }

    .switcher-label {
      flex: none;
    }

    .switcher-name {
      overflow: hidden;
      font-size: 0.875rem;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .switcher-caret {
      flex: none;
      color: var(--sw-text-subtle);
    }

    /* The one place in the chrome allowed to be loud, and only when it must. */
    .down-badge {
      display: inline-flex;
      align-items: center;
      flex: none;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--sw-down);
      color: #fff;
      font-size: 0.6875rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    /* --- account ---------------------------------------------------------- */

    .avatar {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      flex: none;
      margin-left: 4px;
      border: 1px solid var(--sw-border);
      border-radius: 50%;
      background: var(--sw-surface-3);
      color: var(--sw-text-muted);
      font: inherit;
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition:
        border-color 120ms ease,
        color 120ms ease;
    }

    .avatar:hover {
      border-color: var(--sw-border-strong);
      color: var(--sw-text);
    }

    .menu-email {
      padding: 10px 16px 8px;
      border-bottom: 1px solid var(--sw-border);
      color: var(--sw-text-muted);
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .menu-project {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    }

    .menu-project-name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .menu-project-down {
      flex: none;
      color: var(--sw-down);
      font-size: 0.75rem;
      font-weight: 600;
    }

    /* Narrow screens: the bar becomes two rows rather than pushing the project
       switcher off the side of the page. Nothing here is optional — which project
       you are looking at, and whether anything in it is down, has to stay visible. */
    @media (max-width: 680px) {
      .bar-inner {
        flex-wrap: wrap;
        height: auto;
        padding: 8px 14px 0;
        row-gap: 4px;
      }

      .brand {
        margin-right: auto;
      }

      .spacer {
        display: none;
      }

      .nav {
        order: 10;
        width: 100%;
        overflow-x: auto;
        padding-bottom: 6px;
        scrollbar-width: none;
      }

      .nav::-webkit-scrollbar {
        display: none;
      }

      .nav a {
        padding: 6px 10px;
        white-space: nowrap;
      }

      .switcher {
        max-width: 190px;
      }

      .switcher-label {
        display: none;
      }
    }

    @media (max-width: 440px) {
      .wordmark {
        display: none;
      }

      .switcher {
        max-width: 160px;
      }
    }
  `,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);

  protected readonly selectedName = computed(() => this.projects.selected()?.name ?? 'Project');

  protected readonly downCount = computed(() => this.projects.selected()?.downCount ?? 0);

  /** Initials beat a generic silhouette: they say *which* account is signed in. */
  protected readonly initials = computed(() => {
    const user = this.auth.user();
    const source = user?.name?.trim() || user?.email?.trim() || '';
    const words = source.split(/[\s@._-]+/u).filter((word) => word.length > 0);
    const letters = words.slice(0, 2).map((word) => word[0] ?? '');
    return letters.join('').toUpperCase() || '?';
  });
}
