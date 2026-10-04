import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { MessageKey } from '../../../../core/i18n/messages';
import { I18n, type Language } from '../../../../core/i18n/i18n.service';
import { ThemeService, type ThemeChoice } from '../../../../core/theme.service';
import { FlagComponent } from '../../../../shared/flag.component';
import { IconComponent } from '../../../../shared/icon.component';

/** Language and colour mode, kept in this browser. */
@Component({
  selector: 'sw-preferences-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlagComponent, IconComponent],
  templateUrl: './preferences-tab.component.html',
  styleUrls: ['../../section.scss', './preferences-tab.component.scss'],
})
export class PreferencesTabComponent {
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly language = this.i18n.language;
  protected readonly theme = inject(ThemeService);

  /** Named in their own language, as language pickers do: you find yours by its own word. */
  protected readonly languages: ReadonlyArray<{
    code: Language;
    flag: 'fr' | 'gb';
    name: string;
  }> = [
    { code: 'fr', flag: 'fr', name: 'Français' },
    { code: 'en', flag: 'gb', name: 'English' },
  ];

  protected readonly themes: ReadonlyArray<{
    choice: ThemeChoice;
    icon: string;
    label: MessageKey;
  }> = [
    { choice: 'system', icon: 'monitor', label: 'prefs.themeSystem' },
    { choice: 'light', icon: 'sun', label: 'prefs.themeLight' },
    { choice: 'dark', icon: 'moon', label: 'prefs.themeDark' },
  ];

  protected setLanguage(language: Language): void {
    void this.i18n.set(language);
  }
}
