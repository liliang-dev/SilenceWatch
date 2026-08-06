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
  templateUrl: './project-form.dialog.html',
  styleUrl: './project-form.dialog.scss',
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
