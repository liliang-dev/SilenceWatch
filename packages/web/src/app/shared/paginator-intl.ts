import { Injectable, effect, inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { I18n } from '../core/i18n/i18n.service';

/**
 * The paginator's own words — "Items per page", "Next page", "1 – 10 of 42" —
 * in the language of the application.
 *
 * Material ships them in English and reads them from this one object, so a
 * French table with an English footer is fixed here and not in six templates.
 * It is provided by the components that show a paginator rather than at the
 * root, so the paginator's code is not pulled into the first bundle just to
 * translate a footer the login page does not have.
 */
@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
  private readonly i18n = inject(I18n);

  constructor() {
    super();
    this.refresh();
    // Re-labels on a language change and tells the paginators to re-render.
    effect(() => {
      this.i18n.language();
      this.refresh();
      this.changes.next();
    });
  }

  private refresh(): void {
    const { t } = this.i18n;
    this.itemsPerPageLabel = t('paginator.itemsPerPage');
    this.nextPageLabel = t('paginator.next');
    this.previousPageLabel = t('paginator.previous');
    this.firstPageLabel = t('paginator.first');
    this.lastPageLabel = t('paginator.last');
    this.getRangeLabel = (page, pageSize, length) => {
      if (length === 0 || pageSize === 0) return t('paginator.empty', { length });
      const start = page * pageSize;
      const end = Math.min(start + pageSize, length);
      return t('paginator.range', { start: start + 1, end, length });
    };
  }
}

/** For a component's `providers`. */
export const PAGINATOR_INTL = {
  provide: MatPaginatorIntl,
  useClass: TranslatedPaginatorIntl,
};
