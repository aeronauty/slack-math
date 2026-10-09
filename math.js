(function (root) {
  const delimiters = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false]];
  function escaped(text, index) {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count++;
    return count % 2 === 1;
  }
  function splitMath(text) {
    const parts = [];
    let cursor = 0;
    let plain = 0;
    while (cursor < text.length) {
      const delimiter = delimiters.find(([open]) => text.startsWith(open, cursor) && !escaped(text, cursor));
      if (!delimiter) { cursor++; continue; }
      const [open, close, display] = delimiter;
      const start = cursor + open.length;
      let end = text.indexOf(close, start);
      while (end !== -1 && escaped(text, end)) end = text.indexOf(close, end + close.length);
      if (end === -1) { cursor += open.length; continue; }
      const tex = text.slice(start, end);
      // shortcut: dollar delimiters are ambiguous with money; use \(...\) for numeric-only math.
      const valid = tex.length > 0 && tex.length <= 8000 &&
        (open !== '$' || (!/^\s|\s$/.test(tex) && !tex.includes('\n') && !/^\d[\d,.]*$/.test(tex)));
      if (!valid) { cursor += open.length; continue; }
      if (plain < cursor) parts.push({ text: text.slice(plain, cursor) });
      parts.push({ tex, display, source: text.slice(cursor, end + close.length) });
      cursor = end + close.length;
      plain = cursor;
    }
    if (plain < text.length) parts.push({ text: text.slice(plain) });
    return parts;
  }
  root.SlackMath = { splitMath };
  if (typeof module !== 'undefined') module.exports = { splitMath };
})(globalThis);
