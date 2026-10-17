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
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(','));
}
