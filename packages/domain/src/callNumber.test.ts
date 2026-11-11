import { describe, expect, it } from 'vitest';
import { composeCallNo, cutterEntry, cutterNumber, deweyCategory, lcCutter, normalizeDewey, titleLetter, vietnameseNaturalOrder } from './callNumber.js';

describe('Dewey (FR-LIB-01)', () => {
  it('normalises Open Library values', () => {
    expect(normalizeDewey('891.73/3')).toBe('891.733');
    expect(normalizeDewey(' 823.914 ')).toBe('823.914');
    expect(normalizeDewey('813')).toBe('813');
    expect(normalizeDewey('B')).toBeNull();
    expect(normalizeDewey('')).toBeNull();
  });

  it('suggests the category from the main class', () => {
    expect(deweyCategory('891.733')).toBe('Văn học');
    expect(deweyCategory('530.1')).toBe('Khoa học tự nhiên');
    expect(deweyCategory(null)).toBeNull();
  });

  it('composes the call number, null when unclassified', () => {
    expect(composeCallNo('891.73/3', 'D67c')).toBe('891.733 D67c');
    expect(composeCallNo('813', '')).toBe('813');
    expect(composeCallNo(null, 'D67c')).toBeNull();
  });
});

describe('LC Cutter table (G 63)', () => {
  it.each([
    // Initial vowels
    ['Archer', 'A73'],
    ['Ashley', 'A84'],
    ['Atwater', 'A89'],
    // Initial S
    ['Sabine', 'S23'],
    ['Schaefer', 'S33'],
    ['Shillingburg', 'S55'],
    ['Smith', 'S65'],
    // Initial Qu and Q
    ['Quinn', 'Q56'],
    ['Qadri', 'Q23'],
    // Other consonants
    ['Callahan', 'C35'],
    ['Carter', 'C37'],
    ['Childs', 'C45'],
    ['Croft', 'C76'],
    ['Dostoevsky', 'D67'],
    ['Dostoievski', 'D67'],
    ['Lee', 'L44'],
  ])('%s → %s', (name, cutter) => {
    expect(lcCutter(name)).toBe(cutter);
  });
});

describe('Cutter line (FR-LIB-02a)', () => {
  it('cuts foreign names on the surname', () => {
    expect(cutterEntry('Fyodor Dostoevsky', 'en')).toBe('Dostoevsky');
    expect(cutterEntry('Dostoevsky, Fyodor', 'en')).toBe('Dostoevsky');
    expect(cutterNumber('Fiódor Dostoievski', 'Crime and punishment', 'en')).toBe('D67c');
    expect(cutterNumber('Harper Lee', 'To Kill a Mockingbird', 'en')).toBe('L44t');
  });

  it('cuts Vietnamese names on the given name, in either word order', () => {
    expect(vietnameseNaturalOrder('Nhật Ánh Nguyễn')).toBe('Nguyễn Nhật Ánh');
    expect(vietnameseNaturalOrder('Nguyễn Nhật Ánh')).toBe('Nguyễn Nhật Ánh');
    expect(cutterEntry('Nhật Ánh Nguyễn', 'vi')).toBe('Ánh');
    expect(cutterNumber('Nguyễn Nhật Ánh', 'Mắt biếc', 'vi')).toBe('A54m');
    expect(cutterNumber('Tô Hoài', 'Dế Mèn phiêu lưu ký', 'vi')).toBe('H63d');
  });

  it('skips English articles in the title letter and works without an author', () => {
    expect(titleLetter('The Great Gatsby')).toBe('g');
    expect(titleLetter('An Inspector Calls')).toBe('i');
    expect(titleLetter('Đất rừng phương Nam')).toBe('d');
    expect(cutterNumber('', 'The Odyssey', 'en')).toBe('O39');
  });
});
