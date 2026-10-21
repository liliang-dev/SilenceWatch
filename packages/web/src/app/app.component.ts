import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { PasskeyPromptService } from './core/auth/passkey-prompt.service';
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

  private readonly passkeyPrompt = inject(PasskeyPromptService);
  private readonly router = inject(Router);

  /**
   * The sign-in screens are not part of the application: a person is signed in a
   * moment before the recovery codes they must save are shown there, and the bar
   * around that page would invite them to leave it.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly onAuthScreen = computed(() => /^\/(login|setup)(\?|$)/.test(this.url()));

  constructor() {
    // Once there is a session, and only once per page: a passkey is offered to
    // someone who came in another way.
    effect(() => {
      if (this.auth.isAuthenticated()) untracked(() => void this.passkeyPrompt.maybeOffer());
    });
  }

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
