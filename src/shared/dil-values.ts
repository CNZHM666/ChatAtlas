/** A deliberately small data-expression interpreter. No eval, function construction, globals or prototype access. */
export function dilValue(source: string, scope: Record<string, unknown>): unknown {
  if (source.length > 6000) return undefined;
  const tokens = source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|===|!==|==|!=|&&|\|\||>=|<=|[\w$]+|[^\s]/gu) ?? [];
  let at = 0, steps = 0;
  const own = (value: unknown, key: string): unknown => {
    if (["__proto__", "prototype", "constructor"].includes(key)) return undefined;
    if ((Array.isArray(value) || typeof value === "string") && key === "length") return value.length;
    return value && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
  };
  const need = (token: string) => { if (tokens[at++] !== token) throw Error("Unsupported expression"); };
  const precedence: Record<string, number> = { "||": 1, "&&": 2, "===": 3, "!==": 3, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6 };
  const expression = (minimum = 0): unknown => {
    if (++steps > 1000) throw Error("Expression limit");
    const token = tokens[at++];
    let value: unknown;
    if (token === "!") value = !expression(7);
    else if (token === "-") value = -Number(expression(7));
    else if (token === "(") { value = expression(); need(")"); }
    else if (token === "[") {
      const array: unknown[] = [];
      while (tokens[at] !== "]") { array.push(expression()); if (tokens[at] !== ",") break; at++; }
      need("]"); value = array;
    } else if (token === "{") {
      const object: Record<string, unknown> = Object.create(null);
      while (tokens[at] !== "}") {
        const key = tokens[at++]; need(":");
        const name = key.startsWith('"') ? JSON.parse(key) as string : key.startsWith("'") ? key.slice(1, -1) : key;
        object[name] = expression(); if (tokens[at] !== ",") break; at++;
      }
      need("}"); value = object;
    } else if (token?.startsWith('"')) value = JSON.parse(token);
    else if (token?.startsWith("'")) value = token.slice(1, -1).replace(/\\(['\\])/gu, "$1");
    else if (/^\d/u.test(token ?? "")) value = Number(token);
    else if (token === "true" || token === "false") value = token === "true";
    else if (token === "null") value = null;
    else if (token && Object.hasOwn(scope, token)) value = scope[token];
    else throw Error("Unknown value");
    for (;;) {
      if (tokens[at] === ".") {
        at++; const key = tokens[at++];
        if (tokens[at] === "(" && key === "includes" && (Array.isArray(value) || typeof value === "string")) { at++; const item = expression(); need(")"); value = typeof value === "string" ? value.includes(String(item)) : value.includes(item); }
        else value = own(value, key);
      } else if (tokens[at] === "[") { at++; const key = String(expression()); need("]"); value = own(value, key); }
      else break;
    }
    while ((precedence[tokens[at]] ?? -1) >= minimum) {
      const operator = tokens[at++], right = expression(precedence[operator] + 1), left = value;
      switch (operator) {
        case "===": case "==": value = left === right; break;
        case "!==": case "!=": value = left !== right; break;
        case "&&": value = left && right; break;
        case "||": value = left || right; break;
        case "+": value = typeof left === "string" || typeof right === "string" ? String(left) + String(right) : Number(left) + Number(right); break;
        case "-": value = Number(left) - Number(right); break;
        case "*": value = Number(left) * Number(right); break;
        case "/": value = Number(left) / Number(right); break;
        case ">": value = Number(left) > Number(right); break;
        case "<": value = Number(left) < Number(right); break;
        case ">=": value = Number(left) >= Number(right); break;
        case "<=": value = Number(left) <= Number(right); break;
      }
    }
    if (minimum === 0 && tokens[at] === "?") { at++; const yes = expression(); need(":"); const no = expression(); value = value ? yes : no; }
    return value;
  };
  try { const result = expression(); return at === tokens.length ? result : undefined; } catch { return undefined; }
}
