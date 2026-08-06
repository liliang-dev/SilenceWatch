import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LIMITS, type ProjectDto } from '@silencewatch/shared';

export interface ProjectFormData {
  /** Absent when creating. */
  project?: ProjectDto;
}

/**
 * Naming a project, whether it is new or being renamed.
 *
 * One dialog for both because it is one form: a name, its length rule and its
 * error message. Renaming used to be a `window.prompt`, which cannot show a
 * validation message, cannot be styled, and looks like the browser asking
 * rather than the application.
 */
@Component({
  selector: 'sw-project-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title class="title">{{ data.project ? 'Rename project' : 'New project' }}</h2>

    <mat-dialog-content>
      <form [formGroup]="form" (ngSubmit)="submit()" class="sw-form body">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" placeholder="Billing jobs" required cdkFocusInitial />
          @if (form.controls.name.touched && form.controls.name.invalid) {
            <mat-error>A name is required, up to {{ maxLength }} characters</mat-error>
          }
        </mat-form-field>

        @if (data.project) {
          <p class="note sw-subtle">
            The URL slug stays <span class="sw-mono">{{ data.project.slug }}</span
            >. Ping URLs already deployed keep working.
          </p>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="actions">
      <button mat-button type="button" (click)="dialogRef.close()">Cancel</button>
      <button mat-flat-button type="button" [disabled]="form.invalid" (click)="submit()">
        {{ data.project ? 'Rename' : 'Create project' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      padding-bottom: 4px !important;
      font-size: 1.0625rem !important;
      font-weight: 600 !important;
    }

    .body {
      min-width: min(380px, 74vw);
      padding-top: 8px;
    }

    .note {
      margin: 0;
      font-size: 0.8125rem;
      line-height: 1.5;
    }

    .actions {
      padding: 14px 24px 18px !important;
      gap: 8px;
    }
  `,
})
export class ProjectFormDialog {
  protected readonly data = inject<ProjectFormData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<ProjectFormDialog, string>>(MatDialogRef);

  private readonly formBuilder = inject(FormBuilder);

  protected readonly maxLength = LIMITS.nameMax;
  protected readonly form = this.formBuilder.nonNullable.group({
    name: [
      this.data.project?.name ?? '',
      [Validators.required, Validators.maxLength(LIMITS.nameMax)],
    ],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const name = this.form.getRawValue().name.trim();
    // Closing with undefined means "cancelled", so an unchanged name is treated
    // as one rather than sending a request that would change nothing.
    if (name === '' || name === this.data.project?.name) {
      this.dialogRef.close();
      return;
    }
    this.dialogRef.close(name);
  }
}
