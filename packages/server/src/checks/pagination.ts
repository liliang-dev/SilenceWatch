import type { PageDto } from '@silencewatch/shared';

/**
 * Turns `limit + 1` rows into a page: the extra row only says there is more, and
 * its predecessor's id becomes the cursor for the next request.
 */
export function paginate<TRow extends { id: string | bigint }, TDto>(
  rows: TRow[],
  limit: number,
  map: (row: TRow) => TDto,
): PageDto<TDto> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: hasMore && last !== undefined ? String(last.id) : null,
  };
}

/** Ping ids are 64-bit; anything that is not a plain integer is treated as no cursor. */
export function parseBigIntCursor(cursor: string | undefined): bigint | null {
  if (cursor === undefined || !/^\d{1,19}$/.test(cursor)) return null;
  try {
    return BigInt(cursor);
  } catch {
    return null;
  }
}
