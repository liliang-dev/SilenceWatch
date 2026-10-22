import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { I18n } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/messages';
import { DURATION_UNITS, splitDuration, toSeconds, type DurationUnit } from './duration';

/**
 * A length of time typed the way people say it: a number and a unit ("2 hours",
 * "1 week"). The form's control holds seconds, which is what the server takes, so
 * the field can sit in front of any `FormControl<number>` and its validators
 * (`min`, `max`) keep working on the real value.
 *
 * Opening a saved value shows it in the largest unit that divides it exactly, so
 * 3600 is "1 hour" and 5400 is "90 minutes".
 */
@Component({
  selector: 'sw-duration-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="row">
      <mat-form-field appearance="outline" class="amount">
        <mat-label>{{ label() }}</mat-label>
        <input
          matInput
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          [value]="amount()"
          [required]="required()"
          [attr.aria-describedby]="hint() ? undefined : null"
          (input)="onAmount($any($event.target).value)"
          (blur)="touch()"
        />
        @if (invalid() && message()) {
          <mat-error>{{ message() }}</mat-error>
        } @else if (hint()) {
          <mat-hint>{{ hint() }}</mat-hint>
        }
      </mat-form-field>

      <mat-form-field appearance="outline" class="unit">
        <mat-label>{{ t('duration.unit') }}</mat-label>
        <mat-select [value]="unit()" (selectionChange)="onUnit($event.value)" (closed)="touch()">
          @for (option of units(); track option) {
            <mat-option [value]="option">{{ t(unitKey[option]) }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>
  `,
  styles: `
    .row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .amount {
      flex: 1 1 auto;
      min-width: 0;
    }
    .unit {
      flex: 0 0 8.5rem;
    }
    /* Material gives a field's input a 180px minimum, so two of them side by side
       are wider than a phone's dialog. The row shares what there is instead. */
    :host ::ng-deep .mat-mdc-form-field-infix {
      width: auto;
      min-width: 0;
    }
  `,
})
export class DurationFieldComponent implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly hint = input<string>('');
  readonly required = input(false);
  /** The units offered, smallest first. */
  readonly units = input<readonly DurationUnit[]>(DURATION_UNITS);
  /** The unit shown for an empty field, or for zero. */
  readonly defaultUnit = input<DurationUnit>('minutes');
  /** What to say when the control is under its `min` or over its `max`, in seconds. */
  readonly minMessage = input<string>('');
  readonly maxMessage = input<string>('');

  protected readonly t = inject(I18n).t;
  protected readonly unitKey: Readonly<Record<DurationUnit, MessageKey>> = {
    seconds: 'duration.seconds',
    minutes: 'duration.minutes',
    hours: 'duration.hours',
    days: 'duration.days',
    weeks: 'duration.weeks',
  };
  private readonly control = inject(NgControl, { self: true, optional: true });

  protected readonly amount = signal<string>('');
  protected readonly unit = signal<DurationUnit>('minutes');
  private readonly state = signal(0);

  private onChange: (seconds: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    if (this.control !== null) this.control.valueAccessor = this;
  }

  protected readonly invalid = computed(() => {
    this.state();
    return this.control?.touched === true && this.control.invalid === true;
  });

  protected readonly message = computed(() => {
    this.state();
    const errors = this.control?.errors ?? {};
    if (errors['min'] !== undefined) return this.minMessage();
    if (errors['max'] !== undefined) return this.maxMessage();
    return '';
  });

  writeValue(seconds: number | null): void {
    if (seconds === null || seconds === undefined) {
      this.amount.set('');
      this.unit.set(this.defaultUnit());
      return;
    }
    const split = splitDuration(Number(seconds), this.units(), this.defaultUnit());
    this.amount.set(String(split.value));
    this.unit.set(split.unit);
  }

  registerOnChange(fn: (seconds: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  protected onAmount(raw: string): void {
    this.amount.set(raw);
    this.emit();
  }

  protected onUnit(unit: DurationUnit): void {
    this.unit.set(unit);
    this.emit();
  }

  protected touch(): void {
    this.onTouched();
    this.state.update((n) => n + 1);
  }

  private emit(): void {
    this.onChange(toSeconds(this.amount(), this.unit()));
    this.state.update((n) => n + 1);
  }
}
