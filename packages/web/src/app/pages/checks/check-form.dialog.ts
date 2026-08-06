import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  isValidCronExpression,
  isValidTimezone,
  LIMITS,
  type CheckDto,
  type CreateCheckRequest,
} from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';

/** The same rules the server enforces, applied while the user is still typing. */
function cronValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  return value === '' || isValidCronExpression(value) ? null : { cron: true };
}

function timezoneValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  return value === '' || isValidTimezone(value) ? null : { timezone: true };
}

export interface CheckFormData {
  projectId: string;
  /** Present when editing; absent when creating. */
  check?: CheckDto;
}

/**
 * Create or edit a check.
 *
 * The same validation rules as the server (`@silencewatch/shared`) run here, so
 * a mistake is caught while typing instead of coming back as a 400.
 */
@Component({
  selector: 'sw-check-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './check-form.dialog.html',
  styleUrl: './check-form.dialog.scss',
})
export class CheckFormDialog {
  protected readonly data = inject<CheckFormData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<CheckFormDialog, CheckDto>>(MatDialogRef);

  private readonly api = inject(ApiService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly minPeriod = LIMITS.periodSecondsMin;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [this.data.check?.name ?? '', [Validators.required, Validators.maxLength(LIMITS.nameMax)]],
    scheduleType: [this.data.check?.scheduleType ?? ('interval' as 'interval' | 'cron')],
    periodSeconds: [
      this.data.check?.periodSeconds ?? 3600,
      [Validators.min(LIMITS.periodSecondsMin), Validators.max(LIMITS.periodSecondsMax)],
    ],
    cronExpression: [
      this.data.check?.cronExpression ?? '',
      [cronValidator],
    ],
    timezone: [
      this.data.check?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      [timezoneValidator],
    ],
    graceSeconds: [
      this.data.check?.graceSeconds ?? 300,
      [Validators.required, Validators.min(0), Validators.max(LIMITS.graceSecondsMax)],
    ],
    environment: [this.data.check?.environment ?? ''],
  });

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    const value = this.form.getRawValue();
    const schedule =
      value.scheduleType === 'cron'
        ? {
            scheduleType: 'cron' as const,
            cronExpression: value.cronExpression,
            timezone: value.timezone,
          }
        : { scheduleType: 'interval' as const, periodSeconds: Number(value.periodSeconds) };

    const request: CreateCheckRequest = {
      name: value.name,
      graceSeconds: Number(value.graceSeconds),
      ...(value.environment.trim() === '' ? {} : { environment: value.environment.trim() }),
      ...schedule,
    };

    const call = this.data.check
      ? this.api.updateCheck(this.data.check.id, request)
      : this.api.createCheck(this.data.projectId, request);

    call.subscribe({
      next: (check) => this.dialogRef.close(check),
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Could not save the check.'));
      },
    });
  }
}
