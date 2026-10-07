import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { BillingStore } from '../../core/billing.store';
import { I18n } from '../../core/i18n/i18n.service';
import { ProjectStore } from '../../core/project.store';
import { ScrollTabsDirective } from '../../shared/scroll-tabs.directive';
import { SettingsFeedback } from './settings-feedback';
import { AccountTabComponent } from './tabs/account/account-tab.component';
import { ApiKeysTabComponent } from './tabs/api-keys/api-keys-tab.component';
import { PasswordTabComponent } from './tabs/password/password-tab.component';
import { PreferencesTabComponent } from './tabs/preferences/preferences-tab.component';
import { ProjectsTabComponent } from './tabs/projects/projects-tab.component';
import { SecurityTabComponent } from './tabs/security/security-tab.component';
import { SubscriptionTabComponent } from './tabs/subscription/subscription-tab.component';

/**
 * Project and account settings: the page is only the tab strip and the error
 * banner; each tab (`tabs/<name>/`) is a component with its own state.
 *
 * The subscription tab exists only where the server sells subscriptions: it is
 * not there at all on a self-hosted instance. Stripe sends people back to
 * `?tab=subscription`, which opens it.
 */
@Component({
  selector: 'sw-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountTabComponent,
    ApiKeysTabComponent,
    MatTabsModule,
    PasswordTabComponent,
    PreferencesTabComponent,
    ProjectsTabComponent,
    ScrollTabsDirective,
    SecurityTabComponent,
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
