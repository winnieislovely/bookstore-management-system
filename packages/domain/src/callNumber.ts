/**
 * Library call numbers (FR-LIB-01, FR-LIB-02a, TDD §4.x Library): Dewey normalising, the Library of
 * Congress Cutter table, the title letter and the category suggested from the Dewey main class.
 * Vietnamese names are cut on the given name (the last word in natural order).
 */

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'));

/** `891.73/3` → `891.733`; null unless it is a Dewey number (three digits, optional decimals). */
export function normalizeDewey(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.replace(/[\s/']/g, '').replace(/^\[|\]$/g, '');
  const m = /^(\d{3})(?:\.(\d+))?/.exec(s);
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2]}` : m[1]!;
}

/** Common Vietnamese family names, to tell natural order (Nguyễn Nhật Ánh) from library order (Nhật Ánh Nguyễn). */
const VN_SURNAMES = new Set(
  ['nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo', 'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'dinh', 'trinh', 'doan', 'lam', 'luong', 'mai', 'cao', 'trieu', 'ha', 'ta', 'chu', 'luu', 'ton', 'thai', 'quach', 'kieu', 'vuong', 'phung', 'tang', 'au', 'khuc', 'giang', 'hua', 'la', 'thach', 'lai', 'dao', 'nghiem', 'tong', 'van', 'truong'].map(String),
);
const isVnSurname = (w: string) => VN_SURNAMES.has(strip(w).toLowerCase());

/**
 * A Vietnamese name in natural order (family name first). Library records often store it the
 * Western way, family name last; when the last word is a family name and the first is not, the
 * last word is moved to the front.
 */
export function vietnameseNaturalOrder(name: string): string {
  const words = name.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');
  const last = words[words.length - 1]!;
  if (isVnSurname(last) && !isVnSurname(words[0]!)) return [last, ...words.slice(0, -1)].join(' ');
  return words.join(' ');
}

/** The word a Cutter is taken from: the given name for Vietnamese, the surname otherwise. */
export function cutterEntry(author: string, language: 'vi' | 'en'): string {
  const a = author.trim();
  if (!a) return '';
  if (language === 'vi') {
    const words = vietnameseNaturalOrder(a).split(' ');
    return words[words.length - 1]!;
  }
  // “Surname, Given” or “Given Surname”.
  if (a.includes(',')) return a.split(',')[0]!.trim().split(/\s+/).pop()!;
  return a.split(/\s+/).pop()!;
}

// LC Cutter table (Library of Congress, G 63). Digits for the letter after the initial(s).
const VOWEL_SECOND: [string, number][] = [['b', 2], ['d', 3], ['l', 4], ['n', 5], ['p', 6], ['r', 7], ['s', 8], ['u', 9]];
const S_SECOND: [string, number][] = [['a', 2], ['ch', 3], ['e', 4], ['h', 5], ['m', 6], ['t', 7], ['u', 8], ['w', 9]];
const QU_SECOND: [string, number][] = [['a', 3], ['e', 4], ['i', 5], ['o', 6], ['r', 7], ['t', 8], ['y', 9]];
const CONSONANT_SECOND: [string, number][] = [['a', 3], ['e', 4], ['i', 5], ['o', 6], ['r', 7], ['u', 8], ['y', 9]];
const EXPANSION: [string, number][] = [['a', 3], ['e', 4], ['i', 5], ['m', 6], ['p', 7], ['t', 8], ['w', 9]];

/** The digit for `rest` in a table: the last entry not after it (letters between entries take the lower one), else 2. */
function digit(table: [string, number][], rest: string): { d: number; used: number } {
  let best: { d: number; used: number } = { d: 2, used: 1 };
  for (const [key, d] of table) if (rest.slice(0, key.length) >= key) best = { d, used: key.length };
  return best;
}

/** LC Cutter for a name: the initial(s) and two digits, e.g. Dostoevsky → D67, Lee → L44, Anh → A54. */
export function lcCutter(entry: string): string {
  const w = strip(entry).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  const initial = w[0]!.toUpperCase();
  let rest: string;
  let first: { d: number; used: number };
  if ('aeiou'.includes(w[0]!)) {
    rest = w.slice(1);
    first = digit(VOWEL_SECOND, rest);
  } else if (w[0] === 's') {
    rest = w.slice(1);
    first = digit(S_SECOND, rest);
  } else if (w.startsWith('qu')) {
    rest = w.slice(2);
    first = digit(QU_SECOND, rest);
  } else if (w[0] === 'q') {
    // Qa–Qt take 2 (G 63).
    rest = w.slice(1);
    first = { d: 2, used: 1 };
  } else {
    rest = w.slice(1);
    first = digit(CONSONANT_SECOND, rest);
  }
  if (!rest) return initial;
  const after = rest.slice(first.used);
  const second = after ? digit(EXPANSION, after).d : null;
  return `${initial}${first.d}${second ?? ''}`;
}

const ARTICLES = /^(the|a|an)\s+/i;

/** First letter of the title without a leading English article, lower case and unaccented. */
export function titleLetter(title: string): string {
  const t = strip(title.trim()).replace(ARTICLES, '');
  const m = /[a-z0-9]/i.exec(t);
  return m ? m[0]!.toLowerCase() : '';
}

/** Suggested Cutter line: the author's Cutter and the title letter (`D67c`); the title alone gives its letter cut. */
export function cutterNumber(author: string | null | undefined, title: string, language: 'vi' | 'en'): string {
  const entry = author?.trim() ? cutterEntry(author, language) : title.trim() ? strip(title.trim()).replace(ARTICLES, '') : '';
  const cutter = lcCutter(entry);
  if (!cutter) return '';
  return author?.trim() ? `${cutter}${titleLetter(title)}` : cutter;
}

/** Call number shown and printed: `891.733 D67c`; null without a Dewey number (Chưa phân loại). */
export function composeCallNo(dewey: string | null | undefined, cutter: string | null | undefined): string | null {
  const d = normalizeDewey(dewey);
  if (!d) return null;
  const c = cutter?.trim();
  return c ? `${d} ${c}` : d;
}

const MAIN_CLASSES = ['Tổng loại', 'Triết học', 'Tôn giáo', 'Khoa học xã hội', 'Ngôn ngữ', 'Khoa học tự nhiên', 'Công nghệ', 'Nghệ thuật', 'Văn học', 'Lịch sử & địa lý'] as const;

/** Category suggested from the Dewey main class (Design §13.8), e.g. 891.733 → Văn học. */
export function deweyCategory(dewey: string | null | undefined): string | null {
  const d = normalizeDewey(dewey);
  return d ? MAIN_CLASSES[Number(d[0])]! : null;
}
