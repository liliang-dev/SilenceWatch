import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ProjectStore } from './core/project.store';
import { IconComponent } from './shared/icon.component';

/**
 * Application shell: one toolbar, the project being viewed, and three
 * destinations. A monitoring tool is opened to answer one question — "is
 * anything broken?" — so the navigation stays out of the way.
 */
@Component({
  selector: 'sw-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatMenuModule,
  ],
  template: `
    @if (auth.isAuthenticated()) {
      <mat-toolbar class="bar">
        <a routerLink="/checks" class="brand" aria-label="SilenceWatch home">
          <span class="pulse" aria-hidden="true"></span>
          <strong>SilenceWatch</strong>
        </a>

        <nav class="nav">
          <a mat-button routerLink="/checks" routerLinkActive="active">Checks</a>
          <a mat-button routerLink="/channels" routerLinkActive="active">Alerting</a>
          <a mat-button routerLink="/settings" routerLinkActive="active">Settings</a>
        </nav>

        <span class="spacer"></span>

        @if (projects.all().length > 0) {
          <button mat-button [matMenuTriggerFor]="projectMenu" class="project">
            {{ selectedName() }}
            <sw-icon name="expand" class="trailing" />
          </button>
          <mat-menu #projectMenu="matMenu">
            @for (project of projects.all(); track project.id) {
              <button mat-menu-item (click)="projects.select(project.id)">
                {{ project.name }}
                @if (project.downCount) {
                  <span class="down-count">{{ project.downCount }} down</span>
                }
              </button>
            }
          </mat-menu>
        }

        <button mat-icon-button [matMenuTriggerFor]="userMenu" aria-label="Account">
          <sw-icon name="account" />
        </button>
        <mat-menu #userMenu="matMenu">
          <div class="email">{{ auth.user()?.email }}</div>
          <button mat-menu-item routerLink="/settings">Settings</button>
          <button mat-menu-item (click)="auth.logout()">Sign out</button>
        </mat-menu>
      </mat-toolbar>
    }

    <router-outlet />
  `,
  styles: `
    .bar {
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-right: 16px;
      color: inherit;
      text-decoration: none;
      font-size: 1rem;
    }

    /* A heartbeat, since that is what the product is. */
    .pulse {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--sw-state-up);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--sw-state-up) 60%, transparent);
      animation: pulse 2.4s ease-out infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sw-state-up) 60%, transparent); }
      70% { box-shadow: 0 0 0 9px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }

    @media (prefers-reduced-motion: reduce) {
      .pulse { animation: none; }
    }

    .nav {
      display: flex;
      gap: 2px;
    }

    .nav .active {
      font-weight: 600;
      color: var(--mat-sys-primary);
    }

    .spacer {
      flex: 1 1 auto;
    }

    .project {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .down-count {
      margin-left: 8px;
      font-size: 0.75rem;
      color: var(--sw-state-down);
    }

    .email {
      padding: 8px 16px;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    @media (max-width: 640px) {
      .nav a { min-width: 0; padding: 0 8px; }
      .brand strong { display: none; }
    }
  `,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);

  protected readonly selectedName = computed(() => this.projects.selected()?.name ?? 'Project');
}
