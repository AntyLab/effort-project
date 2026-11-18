/**
 * parseExpression(source) evaluates a string containing decimal numbers,
 * parentheses, +, -, *, / and ^, with optional spaces, tabs, CR and LF.
 * Numbers are digits with an optional decimal point and fractional digits,
 * or a leading decimal point followed by digits (1, 1., 1.25 and .25).
 * Signs are operators, not part of a number; exponent notation is not supported.
 *
 * ^ is exponentiation and associates to the right. It binds more tightly than
 * prefix + and -, so -2^2 is -4, 2^-2 is .25, and 2^3^2 is 512.
 * Prefix signs may repeat. * and / bind next and associate left; then binary
 * + and -, also left. Parentheses override precedence. Use JavaScript numeric
 * arithmetic, including its division-by-zero and non-finite results.
 *
 * The whole input must be consumed. For malformed input, throw SyntaxError
 * with a numeric position property: the zero-based original string index of
 * the first unexpected character, or source.length if a required operand or
 * closing parenthesis is missing at the end. The message text is not specified.
 * A trailing token is unexpected at its own start, not the preceding token.
 */
export function parseExpression(source) {
  let position = 0;
  const skip = () => { while (/[ \t\r\n]/.test(source[position] ?? '') && position < source.length) position += 1; };
  const fail = () => { throw Object.assign(new SyntaxError('Unexpected input'), { position }); };
  const take = (char) => {
    skip();
    if (source[position] !== char) return false;
    position += 1;
    return true;
  };
  function primary() {
    skip();
    if (take('(')) {
      const result = sum();
      if (!take(')')) fail();
      return result;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(position));
    if (!number) fail();
    position += number[0].length;
    return Number(number[0]);
  }
  function signed() {
    if (take('+')) return signed();
    if (take('-')) return -signed();
    return primary();
  }
  function unary() {
    let value = signed();
    while (take('^')) value **= signed();
    return value;
  }
  function product() {
    let value = unary();
    while (true) {
      if (take('*')) value *= unary();
      else if (take('/')) value /= unary();
      else return value;
    }
  }
  function sum() {
    let value = product();
    while (true) {
      if (take('+')) value += product();
      else if (take('-')) value -= product();
      else return value;
    }
  }
  const value = sum();
  skip();
  if (position !== source.length) fail();
  return value;
}
