import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CheckState } from '@silencewatch/shared';
import { StateChipComponent } from './state-chip.component';

describe('StateChipComponent', () => {
  let fixture: ComponentFixture<StateChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StateChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(StateChipComponent);
  });

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
    expect(render('DOWN').querySelector('.chip')?.classList.contains('state-down')).toBe(true);
    expect(render('UP').querySelector('.chip')?.classList.contains('state-up')).toBe(true);
    expect(render('DOWN').querySelector('.dot')).not.toBeNull();
  });
});
