/**
 * Selector specificity per Selectors Level 4:
 *   (ids, classes/attributes/pseudo-classes, types/pseudo-elements)
 * :is(), :not(), :has() take the max of their arguments; :where() is 0.
 */
export type Specificity = [number, number, number];

export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function maxOf(list: string): Specificity {
  let best: Specificity = [0, 0, 0];
  for (const s of splitSelectorList(list)) {
    const sp = specificity(s);
    if (compareSpecificity(sp, best) > 0) best = sp;
  }
  return best;
}

export function specificity(selector: string): Specificity {
  const s: Specificity = [0, 0, 0];
  let i = 0;
  const src = selector;
  const readIdent = () => {
    let out = '';
    while (i < src.length && /[\w\-\\ -￿]/.test(src[i])) {
      if (src[i] === '\\') {
        out += src[i] + (src[i + 1] ?? '');
        i += 2;
        continue;
      }
      out += src[i++];
    }
    return out;
  };
  const readParens = () => {
    if (src[i] !== '(') return '';
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return src.slice(start + 1, i - 1);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#') {
      i++;
      readIdent();
      s[0]++;
    } else if (ch === '.') {
      i++;
      readIdent();
      s[1]++;
    } else if (ch === '[') {
      while (i < src.length && src[i] !== ']') i++;
      i++;
      s[1]++;
    } else if (ch === ':') {
      i++;
      if (src[i] === ':') {
        i++;
        readIdent();
        readParens();
        s[2]++;
        continue;
      }
      const name = readIdent().toLowerCase();
      const args = readParens();
      if (name === 'where') continue;
      if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
        const m = maxOf(args);
        s[0] += m[0];
        s[1] += m[1];
        s[2] += m[2];
      } else if ((name === 'nth-child' || name === 'nth-last-child') && / of /.test(args)) {
        const m = maxOf(args.split(/ of /)[1]);
        s[0] += m[0];
        s[1] += m[1] + 1;
        s[2] += m[2];
      } else if (['before', 'after', 'first-line', 'first-letter'].includes(name)) s[2]++;
      else s[1]++;
    } else if (ch === '*' || /[\s>+~|]/.test(ch)) {
      i++;
    } else if (/[a-zA-Z_\-\\]/.test(ch)) {
      readIdent();
      s[2]++;
    } else i++;
  }
  return s;
}
