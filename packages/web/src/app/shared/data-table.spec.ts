import { DataTable, type TableRules } from './data-table';

interface Row {
  name: string;
  environment: string | null;
  score: number;
}

const rules: TableRules<Row> = {
  text: (row) => [row.name, row.environment],
  sortValue: (row, column) => (column === 'score' ? row.score : row.name.toLowerCase()),
  compare: (left, right) => left.name.localeCompare(right.name, 'en'),
  pageSize: 2,
};

const rows: Row[] = [
  { name: 'nightly backup', environment: 'prod', score: 3 },
  { name: 'billing export', environment: 'prod', score: 1 },
  { name: 'cache warm', environment: 'staging', score: 2 },
];

function table(): DataTable<Row> {
  const instance = new DataTable(rules);
  instance.setRows(rows);
  return instance;
}

describe('DataTable', () => {
  it('applies the default order until a column is chosen', () => {
    expect(table().matching().map((row) => row.name)).toEqual([
      'billing export',
      'cache warm',
      'nightly backup',
    ]);
  });

  it('sorts by the chosen column, in both directions', () => {
    const subject = table();

    subject.onSort({ active: 'score', direction: 'asc' });
    expect(subject.matching().map((row) => row.score)).toEqual([1, 2, 3]);

    subject.onSort({ active: 'score', direction: 'desc' });
    expect(subject.matching().map((row) => row.score)).toEqual([3, 2, 1]);
  });

  it('comes back to the default order when the sort is cleared', () => {
    const subject = table();
    subject.onSort({ active: 'score', direction: 'desc' });
    subject.onSort({ active: 'score', direction: '' });

    expect(subject.matching()[0]?.name).toBe('billing export');
  });

  it('searches every field the rules expose, not just the name', () => {
    const subject = table();
    subject.onSearch('staging');

    expect(subject.matching().map((row) => row.name)).toEqual(['cache warm']);
  });

  it('narrows as terms are added rather than widening', () => {
    const subject = table();

    subject.onSearch('prod');
    expect(subject.matching()).toHaveLength(2);

    subject.onSearch('prod billing');
    expect(subject.matching()).toHaveLength(1);
  });

  it('ignores case and matches inside a word', () => {
    const subject = table();
    subject.onSearch('NIGHT');

    expect(subject.matching().map((row) => row.name)).toEqual(['nightly backup']);
  });

  it('pages the matching rows, not the loaded ones', () => {
    const subject = table();

    expect(subject.visible()).toHaveLength(2);
    subject.onPage({ pageIndex: 1, pageSize: 2, length: 3 });
    expect(subject.visible().map((row) => row.name)).toEqual(['nightly backup']);
  });

  // The bug this exists to prevent: narrow the results while on a later page
  // and the table goes blank with rows still in it.
  it('returns to the first page when the search changes', () => {
    const subject = table();
    subject.onPage({ pageIndex: 1, pageSize: 2, length: 3 });
    subject.onSearch('prod');

    expect(subject.page().pageIndex).toBe(0);
    expect(subject.visible().map((row) => row.name)).toEqual(['billing export', 'nightly backup']);
  });

  it('shows the first page rather than nothing if the page index is left behind', () => {
    const subject = table();
    subject.onPage({ pageIndex: 1, pageSize: 2, length: 3 });
    subject.setRows([rows[0] as Row]);

    expect(subject.visible().map((row) => row.name)).toEqual(['nightly backup']);
  });

  it('combines the filter above the table with the search box', () => {
    const subject = table();
    subject.setFilter((row) => row.environment === 'prod');
    expect(subject.matching()).toHaveLength(2);

    subject.onSearch('cache');
    expect(subject.matching()).toHaveLength(0);
  });

  it('reports whether anything is being excluded', () => {
    const subject = table();
    expect(subject.narrowed()).toBe(false);

    subject.setFilter((row) => row.environment === 'staging');
    expect(subject.narrowed()).toBe(true);
  });

  it('breaks sort ties with the default order', () => {
    const subject = new DataTable(rules);
    subject.setRows([
      { name: 'zebra', environment: null, score: 1 },
      { name: 'alpha', environment: null, score: 1 },
    ]);
    subject.onSort({ active: 'score', direction: 'asc' });

    expect(subject.matching().map((row) => row.name)).toEqual(['alpha', 'zebra']);
  });
});
