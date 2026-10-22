import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = document.documentElement;

  const start = (): ThemeService => {
    TestBed.resetTestingModule();
    return TestBed.inject(ThemeService);
  };

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  it('is dark for someone who has not chosen, and stores nothing for them', () => {
    const theme = start();
    expect(theme.choice()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('silencewatch.theme')).toBeNull();
  });

  it.each(['light', 'dark', 'system'] as const)('remembers %s once it is chosen', (choice) => {
    const theme = start();
    theme.set(choice);
    expect(theme.choice()).toBe(choice);
    expect(localStorage.getItem('silencewatch.theme')).toBe(choice);
  });

  it('sets the attribute for light and dark, and leaves the device in charge for system', () => {
    const theme = start();
    theme.set('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    theme.set('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    theme.set('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('reads what was chosen on the last visit, system included', () => {
    for (const choice of ['light', 'dark', 'system'] as const) {
      localStorage.setItem('silencewatch.theme', choice);
      expect(start().choice()).toBe(choice);
    }
  });

  it('falls back to dark on a stored value it does not know', () => {
    localStorage.setItem('silencewatch.theme', 'sepia');
    expect(start().choice()).toBe('dark');
  });
});
