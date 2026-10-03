import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CheckState } from '@silencewatch/shared';
import { loadI18n, provideI18n } from '../core/i18n/i18n.testing';
import { StateChipComponent } from './state-chip.component';

describe('StateChipComponent', () => {
  let fixture: ComponentFixture<StateChipComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [StateChipComponent],
      providers: [provideI18n()],
    }).compileComponents();
    await loadI18n('en');
    fixture = TestBed.createComponent(StateChipComponent);
  });

  afterEach(() => localStorage.clear());

  function render(state: CheckState): HTMLElement {
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('labels NEW as WAITING, because "new" says nothing to the reader', () => {
    expect(render('NEW').textContent?.trim()).toBe('WAITING');
  });

  it.each<[CheckState, string]>([
    ['UP', 'UP'],
    ['LATE', 'LATE'],
    ['DOWN', 'DOWN'],
    ['PAUSED', 'PAUSED'],
  ])('shows %s as %s', (state, label) => {
    expect(render(state).textContent?.trim()).toBe(label);
  });

  it('carries a per-state class, so colour is never the only signal', () => {
    // The label and the dot carry the meaning too: the list stays readable in
    // greyscale and for colour-blind users.
    expect(render('DOWN').querySelector('.chip')?.classList.contains('is-down')).toBe(true);
    expect(render('UP').querySelector('.chip')?.classList.contains('is-up')).toBe(true);
    expect(render('DOWN').querySelector('.dot')).not.toBeNull();
  });
});
