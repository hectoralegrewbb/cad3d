// Evaluador de expresiones numéricas con parámetros nombrados: "D/2 + 1.5", "(L - 10) * 0.5".
// Solo números, identificadores (parámetros), + - * / ^ y paréntesis. No usa eval.

export class ExpressionError extends Error {}

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:[.,]\d+)?|[.,]\d+)|([A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*)|(.))/gy;
  let match;
  while (pattern.lastIndex < source.length && (match = pattern.exec(source))) {
    if (match[1] !== undefined) tokens.push({ type: 'num', value: Number(match[1].replace(',', '.')) });
    else if (match[2] !== undefined) tokens.push({ type: 'id', value: match[2] });
    else if (match[3] !== undefined && match[3].trim()) tokens.push({ type: 'op', value: match[3] });
  }
  return tokens;
}

export function evaluate(expression, params = {}) {
  if (typeof expression === 'number') {
    if (!Number.isFinite(expression)) throw new ExpressionError('Número inválido');
    return expression;
  }
  const source = String(expression ?? '').trim();
  if(source.length>1024)throw new ExpressionError('La expresión supera 1024 caracteres');
  if (source === '') throw new ExpressionError('Valor vacío');
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const parsePrimary = () => {
    const token = take();
    if (!token) throw new ExpressionError(`Expresión incompleta: ${source}`);
    if (token.type === 'num') return token.value;
    if (token.type === 'id') {
      if (!Object.hasOwn(params, token.value)) throw new ExpressionError(`Parámetro desconocido: ${token.value}`);
      return params[token.value];
    }
    if (token.value === '(') {
      const value = parseSum();
      if (take()?.value !== ')') throw new ExpressionError(`Falta ")" en: ${source}`);
      return value;
    }
    if (token.value === '-') return -parseUnary();
    if (token.value === '+') return parseUnary();
    throw new ExpressionError(`Símbolo inesperado "${token.value}" en: ${source}`);
  };
  const parseUnary = () => parsePower();
  const parsePower = () => {
    const base = parsePrimary();
    if (peek()?.value === '^') {
      take();
      return base ** parseUnary();
    }
    return base;
  };
  const parseProduct = () => {
    let value = parseUnary();
    while (peek()?.value === '*' || peek()?.value === '/') {
      const op = take().value;
      const right = parseUnary();
      if (op === '/' && right === 0) throw new ExpressionError('División por cero');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const parseSum = () => {
    let value = parseProduct();
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = take().value;
      const right = parseProduct();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = parseSum();
  if (position < tokens.length) throw new ExpressionError(`Sobra "${tokens[position].value}" en: ${source}`);
  if (!Number.isFinite(result)) throw new ExpressionError(`Resultado inválido: ${source}`);
  return result;
}

// Evalúa los parámetros en orden (pueden depender de los anteriores). Devuelve {values, errors}.
export function evaluateParams(paramList) {
  const values = Object.create(null);
  const errors = {};
  paramList.forEach(({ name, value }) => {
    try {
      values[name] = evaluate(value, values);
    } catch (error) {
      errors[name] = error.message;
    }
  });
  return { values, errors };
}
