import { paginate, parseBigIntCursor, parseUuidCursor } from './pagination';

describe('paginate', () => {
  const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];

  it('drops the extra row and points the cursor at the last one kept', () => {
    expect(paginate(rows, 2, (row) => row.id)).toEqual({ items: ['1', '2'], nextCursor: '2' });
  });

  it('has no cursor when the page is the last', () => {
    expect(paginate(rows.slice(0, 2), 2, (row) => row.id)).toEqual({
      items: ['1', '2'],
      nextCursor: null,
    });
  });

  it('copes with bigint ids', () => {
    expect(paginate([{ id: 9n }, { id: 8n }], 1, (row) => row.id).nextCursor).toBe('9');
  });
});

describe('parseBigIntCursor', () => {
  it('reads a plain integer and ignores anything else', () => {
    expect(parseBigIntCursor('42')).toBe(42n);
    expect(parseBigIntCursor(undefined)).toBeNull();
    expect(parseBigIntCursor('4 2')).toBeNull();
    expect(parseBigIntCursor('-1')).toBeNull();
    expect(parseBigIntCursor('12345678901234567890')).toBeNull();
  });
});

describe('parseUuidCursor', () => {
  it('keeps an incident id and drops anything the database could not compare with one', () => {
    expect(parseUuidCursor('0b9f1c3e-4c1a-4f6e-9d2a-7b8c9d0e1f2a')).toBe('0b9f1c3e-4c1a-4f6e-9d2a-7b8c9d0e1f2a');
    for (const cursor of [undefined, '', 'abc', "1' OR '1'='1", '0b9f1c3e-4c1a-4f6e-9d2a-7b8c9d0e1f2a-x']) {
      expect(parseUuidCursor(cursor)).toBeUndefined();
    }
  });
});
