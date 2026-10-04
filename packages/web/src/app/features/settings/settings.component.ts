import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
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

/**
 * Project and account settings: the page is only the tab strip and the error
 * banner; each tab (`tabs/<name>/`) is a component with its own state.
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
  ],
  providers: [SettingsFeedback],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  protected readonly feedback = inject(SettingsFeedback);
  protected readonly t = inject(I18n).t;

  constructor() {
    inject(ProjectStore).load();
  }
}
