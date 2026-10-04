import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ProjectDto } from '@silencewatch/shared';
import { ProjectsApi } from '../../../../core/api/projects.api';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import { ProjectStore } from '../../../../core/project.store';
import { confirmWith } from '../../../../shared/confirm.dialog';
import { IconComponent } from '../../../../shared/icon.component';
import { ProjectFormDialog, type ProjectFormData } from '../../dialogs/project-form.dialog';
import { SettingsFeedback } from '../../settings-feedback';

/** The account's projects: create, rename, delete. */
@Component({
  selector: 'sw-projects-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatButtonModule, MatTooltipModule],
  templateUrl: './projects-tab.component.html',
  styleUrls: ['../../section.scss', './projects-tab.component.scss'],
})
export class ProjectsTabComponent {
  private readonly api = inject(ProjectsApi);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly feedback = inject(SettingsFeedback);
  private readonly i18n = inject(I18n);
  protected readonly projects = inject(ProjectStore);
  protected readonly t = this.i18n.t;
  protected readonly plural = this.i18n.plural;
  protected readonly projectBusy = signal(false);

  protected createProject(): void {
    this.openProjectForm({}).subscribe((name) => {
      if (name === undefined) return;

      this.projectBusy.set(true);
      this.feedback.clear();
      this.api.create(name).subscribe({
        next: (project) => {
          this.projects.add(project);
          this.projectBusy.set(false);
          this.snackBar.open(
            this.t('settings.projectCreated', { name: project.name }),
            this.t('common.ok'),
            { duration: 4000 },
          );
        },
        error: (failure: unknown) => {
          this.projectBusy.set(false);
          this.feedback.show(errorMessage(failure, this.t('settings.projectCreateFailed'), this.t));
        },
      });
    });
  }

  protected renameProject(project: ProjectDto): void {
    this.openProjectForm({ project }).subscribe((name) => {
      if (name === undefined) return;

      this.api.update(project.id, { name }).subscribe({
        next: (updated) => {
          this.projects.replace(updated);
          this.snackBar.open(this.t('settings.projectRenamed'), this.t('common.ok'), {
            duration: 3000,
          });
        },
        error: (failure: unknown) =>
          this.feedback.show(errorMessage(failure, this.t('settings.projectRenameFailed'), this.t)),
      });
    });
  }

  /** Resolves with the name, or undefined when the dialog was dismissed. */
  private openProjectForm(data: ProjectFormData) {
    // One field: a compact card, not the whole screen the longer forms get on a phone.
    return this.dialog
      .open(ProjectFormDialog, {
        data,
        autoFocus: false,
        panelClass: 'sw-confirm',
      })
      .afterClosed();
  }

  /**
   * Deleting a project destroys every check, ping and incident in it, so the
   * confirmation says how many rather than asking "are you sure?".
   *
   * The button is also disabled on the last project, but that is the courtesy
   * — the server refuses it with a 409 regardless, which is what actually
   * guarantees an account is never left without one.
   */
  protected deleteProject(project: ProjectDto): void {
    const checks = project.checkCount ?? 0;

    confirmWith(this.dialog, {
      title: this.t('settings.projectDeleteTitle', { name: project.name }),
      message:
        checks === 0
          ? this.t('settings.projectDeleteEmpty')
          : this.i18n.plural('settings.projectDeleteMessage', checks),
      confirmLabel: this.t('settings.projectDeleteConfirm'),
      destructive: true,
    }).subscribe(() => {
      this.api.delete(project.id).subscribe({
        next: () => {
          this.projects.remove(project.id);
          this.snackBar.open(
            this.t('settings.projectDeleted', { name: project.name }),
            this.t('common.ok'),
            { duration: 4000 },
          );
        },
        error: (failure: unknown) =>
          this.feedback.show(errorMessage(failure, this.t('settings.projectDeleteFailed'), this.t)),
      });
    });
  }
}
