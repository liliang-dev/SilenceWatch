import { Injectable, computed, inject, signal } from '@angular/core';
import type { ProjectDto } from '@silencewatch/shared';
import { ApiService } from './api.service';

const SELECTED_PROJECT_KEY = 'silencewatch.project';

/**
 * The list of projects and the one currently being looked at.
 *
 * Held here rather than fetched per page so switching between checks, channels
 * and keys does not re-query the same list three times, and so the selection
 * survives a reload.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private readonly api = inject(ApiService);

  private readonly projects = signal<ProjectDto[]>([]);
  private readonly selectedId = signal<string | null>(localStorage.getItem(SELECTED_PROJECT_KEY));
  private readonly loading = signal(false);

  readonly all = this.projects.asReadonly();
  readonly isLoading = this.loading.asReadonly();
  readonly selected = computed<ProjectDto | null>(() => {
    const projects = this.projects();
    const id = this.selectedId();
    return projects.find((project) => project.id === id) ?? projects[0] ?? null;
  });

  load(force = false): void {
    if (this.loading() || (this.projects().length > 0 && !force)) return;

    this.loading.set(true);
    this.api.listProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  select(projectId: string): void {
    this.selectedId.set(projectId);
    localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
  }

  clear(): void {
    this.projects.set([]);
    this.selectedId.set(null);
    localStorage.removeItem(SELECTED_PROJECT_KEY);
  }
}
