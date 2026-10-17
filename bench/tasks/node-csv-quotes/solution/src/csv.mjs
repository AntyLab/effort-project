/**
 * Parse CSV text into records (arrays of field strings).
 *
 * - Fields are separated by commas; records end with "\n" or "\r\n".
 * - A field that starts with a double quote is quoted: until the closing
 *   quote, commas and line breaks are part of the field, and "" stands for
 *   one quote character.
 * - Whitespace is kept as-is. A line break at the very end does not start
 *   another record, and empty text has no records.
 * - An unterminated quoted field throws a SyntaxError.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;
  let recordStarted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
      continue;
    }
    if (char === '\n' || (char === '\r' && text[i + 1] === '\n')) {
      if (char === '\r') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      fieldStart = true;
      recordStarted = false;
      continue;
    }
    recordStarted = true;
    if (char === ',') {
      record.push(field);
      field = '';
      fieldStart = true;
    } else if (char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else {
      field += char;
      fieldStart = false;
    }
  }

  if (inQuotes) throw new SyntaxError('Unterminated quoted field');
  if (recordStarted) {
    record.push(field);
    records.push(record);
  }
  return records;
}
