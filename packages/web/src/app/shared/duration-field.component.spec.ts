import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { DurationFieldComponent } from './duration-field.component';
import { loadI18n, provideI18n } from '../core/i18n/i18n.testing';

@Component({
  imports: [ReactiveFormsModule, DurationFieldComponent],
  template: `<sw-duration-field
    [formControl]="control"
    label="Runs every"
    [required]="true"
    minMessage="At least 30 seconds"
    maxMessage="One year at most"
  />`,
})
class Host {
  control = new FormControl<number | null>(3600, [Validators.required, Validators.min(30), Validators.max(31_536_000)]);
}

describe('DurationFieldComponent', () => {
  async function create(initial: number | null = 3600) {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [Host], providers: [provideI18n()] }).compileComponents();
    await loadI18n('en');
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.control.setValue(initial);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      control: fixture.componentInstance.control,
      input: () => element.querySelector('input') as HTMLInputElement,
      unitText: () => (element.querySelector('mat-select') as HTMLElement).textContent?.trim() ?? '',
    };
  }

  it('shows a saved value in the largest unit that fits it', async () => {
    for (const [seconds, amount, unit] of [
      [3600, '1', 'hours'],
      [5400, '90', 'minutes'],
      [604_800, '1', 'weeks'],
      [45, '45', 'seconds'],
    ] as const) {
      TestBed.resetTestingModule();
      const view = await create(seconds);
      expect(view.input().value).toBe(amount);
      expect(view.unitText()).toBe(unit);
    }
  });

  it('keeps the control in seconds when the person types in another unit', async () => {
    const view = await create(3600);
    const input = view.input();
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    expect(view.control.value).toBe(7200);

    // the unit is still "hours": typing is in the unit that is shown
    input.value = '90';
    input.dispatchEvent(new Event('input'));
    expect(view.control.value).toBe(324_000);
  });

  it('is empty, not zero, when the number is cleared, so `required` can say so', async () => {
    const view = await create(3600);
    view.input().value = '';
    view.input().dispatchEvent(new Event('input'));
    expect(view.control.value).toBeNull();
    expect(view.control.hasError('required')).toBe(true);
  });

  it('lets the control\'s own min and max judge the value in seconds', async () => {
    const view = await create(3600);
    view.input().value = '10';
    view.input().dispatchEvent(new Event('input'));
    expect(view.control.value).toBe(10 * 3600);
    // ten hours is fine; a tenth of a minute (6s) is under the 30s minimum
    view.input().value = '0.1';
    view.input().dispatchEvent(new Event('input'));
    expect(view.control.hasError('min')).toBe(false); // 0.1 hours = 360s
    view.input().value = '0.001';
    view.input().dispatchEvent(new Event('input'));
    expect(view.control.hasError('min')).toBe(true);
  });
});
