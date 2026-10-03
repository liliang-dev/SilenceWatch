import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = document.documentElement;
  let theme: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
    theme = TestBed.inject(ThemeService);
    theme.set('system');
  });

  afterEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  it('follows the device by default: no attribute, nothing stored', () => {
    expect(theme.choice()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('silencewatch.theme')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('applies and remembers %s', (choice) => {
    theme.set(choice);
    expect(theme.choice()).toBe(choice);
    expect(root.getAttribute('data-theme')).toBe(choice);
    expect(localStorage.getItem('silencewatch.theme')).toBe(choice);
  });

  it('goes back to the device when "system" is chosen again', () => {
    theme.set('dark');
    theme.set('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('silencewatch.theme')).toBeNull();
  });
});
