import { formatRupees, round2 } from './money';

describe('round2', () => {
  it.each([
    [1.005, 1.01],
    [2.675, 2.68],
    [0.1 + 0.2, 0.3],
    [99.999, 100],
    [0, 0],
    [1499, 1499],
    [12.344, 12.34],
  ])('rounds %p to %p (paise, half-up despite binary floats)', (n, expected) => {
    expect(round2(n)).toBe(expected);
  });

  it('a sum of float-priced lines never drifts by a paisa', () => {
    const lines = [19.99, 19.99, 19.99];
    expect(round2(lines.reduce((a, b) => a + b, 0))).toBe(59.97);
  });
});

describe('formatRupees', () => {
  it.each([
    [50, '50'],
    [12.5, '12.5'],
    [0.75, '0.75'],
    [10.004, '10'],
    [0.1 + 0.2, '0.3'],
  ])('formats %p as %p', (n, s) => {
    expect(formatRupees(n)).toBe(s);
  });
});
