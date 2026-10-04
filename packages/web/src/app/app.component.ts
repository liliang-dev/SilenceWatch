import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { I18n } from './core/i18n/i18n.service';
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
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly plural = this.i18n.plural;

  protected readonly selectedName = computed(
    () => this.projects.selected()?.name ?? this.t('shell.projectFallback'),
  );

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
