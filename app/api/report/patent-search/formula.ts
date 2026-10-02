/** 将受限布尔检索式编译为参数化 SQL，绝不执行用户提供的 SQL。 */
export function compilePatentFormula(formula: string, values: unknown[]) {
  if (!formula.trim() || formula.length > 2000)
    throw new Error("检索式需为 1 至 2000 字");
  const tokens = formula.match(/"[^"\r\n]+"|[()=]|[^\s()=]+/g) || [];
  if (tokens.length > 250) throw new Error("检索式过于复杂");
  let position = 0;
  const peek = () => tokens[position]?.toUpperCase();
  const fields = new Set(["TIAB", "TI", "AB", "IPC", "CPC", "PA", "PN"]);
  function term(field: string, value: string) {
    const literal = value
      .replace(/^"|"$/g, "")
      .replace(/[\\%_]/g, "\\$&")
      .replace(/\*/g, "%");
    values.push(
      field === "IPC" || field === "CPC"
        ? literal.replace(/\s/g, "") + "%"
        : `%${literal}%`,
    );
    const param = `$${values.length}`;
    if (field === "TIAB")
      return `(p.title ILIKE ${param} OR p.abstract ILIKE ${param})`;
    if (field === "TI" || field === "AB" || field === "PN")
      return `p.${field === "TI" ? "title" : field === "AB" ? "abstract" : "doc_number"} ILIKE ${param}`;
    if (field === "PA")
      return `EXISTS (SELECT 1 FROM cnipa.patent_applicant fa WHERE fa.patent_id=p.id AND fa.name ILIKE ${param})`;
    const type = field.toLowerCase();
    return `EXISTS (SELECT 1 FROM cnipa.patent_${type} fc WHERE fc.patent_id=p.id AND regexp_replace(fc.${type}_code, '[[:space:]]+', '', 'g') ILIKE ${param})`;
  }
  function atom(field: string): string {
    if (peek() === "NOT") {
      position++;
      return `(NOT ${atom(field)})`;
    }
    if (tokens[position + 1] === "=") {
      const nextField = peek()!;
      if (!fields.has(nextField))
        throw new Error(
          `不支持字段 ${nextField}，支持 TIAB、TI、AB、IPC、CPC、PA、PN`,
        );
      position += 2;
      return atom(nextField);
    }
    if (peek() === "(") {
      position++;
      const result = expression(field);
      if (peek() !== ")") throw new Error("检索式括号不匹配");
      position++;
      return `(${result})`;
    }
    const value = tokens[position++];
    if (!value || ["AND", "OR", ")", "="].includes(value.toUpperCase()))
      throw new Error("检索式缺少关键词或运算符");
    return term(field, value);
  }
  function conjunction(field: string): string {
    let left = atom(field);
    while (peek() === "AND") {
      position++;
      left = `(${left} AND ${atom(field)})`;
    }
    return left;
  }
  function expression(field: string): string {
    let left = conjunction(field);
    while (peek() === "OR") {
      position++;
      left = `(${left} OR ${conjunction(field)})`;
    }
    return left;
  }
  const sql = expression("TIAB");
  if (position !== tokens.length)
    throw new Error("请用 AND、OR、NOT 和括号连接关键词，短语请使用英文双引号");
  return sql;
}
