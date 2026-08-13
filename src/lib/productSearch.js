const TOKEN_ALIASES = new Map([
  ["ounces", "oz"],
  ["ounce", "oz"],
  ["ozt", "oz"],
  ["grams", "g"],
  ["gram", "g"],
  ["kilograms", "kg"],
  ["kilogram", "kg"],
  ["kilos", "kg"],
  ["kilo", "kg"],
  ["coins", "coin"],
  ["bars", "bar"],
  ["rounds", "round"],
  ["buffalos", "buffalo"],
  ["eagles", "eagle"],
  ["maples", "maple"],
  ["bullions", "bullion"],
  ["usa", "american"],
  ["us", "american"],
  ["au", "gold"],
  ["ag", "silver"],
  ["pt", "platinum"],
  ["pd", "palladium"],
  ["one", "1"],
  ["five", "5"],
  ["ten", "10"],
  ["twenty", "20"],
  ["quarter", "1 4"],
  ["half", "1 2"],
  ["tenth", "1 10"],
  ["twentieth", "1 20"],
]);

const STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "with"]);

const normalizeToken = (token) => {
  const alias = TOKEN_ALIASES.get(token);
  if (alias) return alias;
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss"))
    return token.slice(0, -1);
  return token;
};

export const normalizeSearchText = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken)
    .join(" ");

const tokenize = (value) => {
  const tokens = normalizeSearchText(value).split(" ").filter(Boolean);
  const meaningfulTokens = tokens.filter((token) => !STOP_WORDS.has(token));
  return meaningfulTokens.length ? meaningfulTokens : tokens;
};

const boundedDamerauLevenshtein = (left, right, limit) => {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0),
  );
  for (let row = 0; row <= left.length; row += 1) matrix[row][0] = row;
  for (let column = 0; column <= right.length; column += 1)
    matrix[0][column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    let rowMinimum = limit + 1;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance = Math.min(distance, matrix[row - 2][column - 2] + 1);
      }
      matrix[row][column] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > limit) return limit + 1;
  }

  return matrix[left.length][right.length];
};

const tokenMatchScore = (queryToken, candidateToken) => {
  if (queryToken === candidateToken) return 120;
  if (queryToken.length >= 2 && candidateToken.startsWith(queryToken))
    return 104 - Math.min(candidateToken.length - queryToken.length, 12);
  if (candidateToken.length >= 3 && queryToken.startsWith(candidateToken))
    return 90 - Math.min(queryToken.length - candidateToken.length, 12);
  if (queryToken.length >= 3 && candidateToken.includes(queryToken)) return 82;
  if (candidateToken.length >= 3 && queryToken.includes(candidateToken)) return 74;

  const longest = Math.max(queryToken.length, candidateToken.length);
  if (Math.min(queryToken.length, candidateToken.length) < 4) return 0;
  const allowedDistance = longest >= 8 ? 2 : 1;
  const distance = boundedDamerauLevenshtein(
    queryToken,
    candidateToken,
    allowedDistance,
  );
  if (distance > allowedDistance) return 0;
  return 68 - distance * 12 - Math.abs(queryToken.length - candidateToken.length);
};

const weightedTokens = (product) => {
  const fields = [
    [product.name, 4],
    [product.sku, 4],
    [product.slug, 3],
    [product.metal, 3],
    [product.category, 2.5],
    [product.short_description, 1.75],
    [product.description, 1],
    [Array.isArray(product.features) ? product.features.join(" ") : "", 1.25],
  ];
  return fields.flatMap(([value, weight]) =>
    tokenize(value).map((token) => ({ token, weight })),
  );
};

const productIndexCache = new WeakMap();

const productSearchIndex = (product) => {
  const cached = productIndexCache.get(product);
  if (cached) return cached;

  const index = {
    candidates: weightedTokens(product),
    normalizedName: normalizeSearchText(product.name),
    normalizedSku: normalizeSearchText(product.sku),
    normalizedPrimary: normalizeSearchText(
      `${product.name || ""} ${product.sku || ""} ${product.metal || ""} ${
        product.category || ""
      }`,
    ),
  };
  productIndexCache.set(product, index);
  return index;
};

export function productSearchScore(product, query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  const {
    candidates,
    normalizedName,
    normalizedSku,
    normalizedPrimary,
  } = productSearchIndex(product);
  if (!candidates.length) return null;

  let score = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(
        best,
        tokenMatchScore(queryToken, candidate.token) * candidate.weight,
      );
    }
    if (!best) return null;
    score += best;
  }

  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = normalizedQuery.replaceAll(" ", "");

  if (normalizedName === normalizedQuery) score += 1_000;
  else if (normalizedName.startsWith(normalizedQuery)) score += 700;
  else if (normalizedName.includes(normalizedQuery)) score += 500;
  else if (normalizedPrimary.includes(normalizedQuery)) score += 260;

  if (
    compactQuery.length >= 3 &&
    `${normalizedName} ${normalizedSku}`.replaceAll(" ", "").includes(compactQuery)
  ) {
    score += 220;
  }

  return score;
}
