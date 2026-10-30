import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { AuthService } from '../../core/auth/auth.service';
import { BillingStore } from '../../core/billing.store';
import { I18n } from '../../core/i18n/i18n.service';
import { ProjectStore } from '../../core/project.store';
import { ScrollTabsDirective } from '../../shared/scroll-tabs.directive';
import { SettingsFeedback } from './settings-feedback';
import { AccountTabComponent } from './tabs/account/account-tab.component';
import { ApiKeysTabComponent } from './tabs/api-keys/api-keys-tab.component';
import { PreferencesTabComponent } from './tabs/preferences/preferences-tab.component';
import { ProjectsTabComponent } from './tabs/projects/projects-tab.component';
import { SecurityTabComponent } from './tabs/security/security-tab.component';
import { SignInTabComponent } from './tabs/sign-in/sign-in-tab.component';
import { StatisticsTabComponent } from './tabs/statistics/statistics-tab.component';
import { SubscriptionTabComponent } from './tabs/subscription/subscription-tab.component';

/**
 * Project and account settings: the page is only the tab strip and the error
 * banner; each tab (`tabs/<name>/`) is a component with its own state.
 *
 * The subscription tab exists only where the server sells subscriptions: it is
 * not there at all on a self-hosted instance. Stripe sends people back to
 * `?tab=subscription`, which opens it.
 *
 * The statistics tab exists only for the administrator (ADMIN_EMAIL). Hiding it is
 * a courtesy: the server refuses its figures to anyone else.
 */
@Component({
  selector: 'sw-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountTabComponent,
    ApiKeysTabComponent,
    MatTabsModule,
    PreferencesTabComponent,
    ProjectsTabComponent,
    ScrollTabsDirective,
    SecurityTabComponent,
    SignInTabComponent,
    StatisticsTabComponent,
    SubscriptionTabComponent,
  ],
  providers: [SettingsFeedback],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  protected readonly feedback = inject(SettingsFeedback);
  protected readonly t = inject(I18n).t;
  protected readonly billing = inject(BillingStore);
  private readonly auth = inject(AuthService);
  protected readonly admin = computed(() => this.auth.user()?.admin === true);
  protected readonly selectedTab = signal(0);

  constructor() {
    inject(ProjectStore).load();

    const wanted = inject(ActivatedRoute).snapshot.queryParamMap.get('tab');
    // A failure to ask leaves the tab hidden, which is the right default: a
    // subscription page that cannot load is not something to show.
    this.billing
      .refresh()
      .then((state) => {
        if (state.enabled && wanted === 'subscription') this.selectedTab.set(1);
      })
      .catch(() => undefined);
  }
}
