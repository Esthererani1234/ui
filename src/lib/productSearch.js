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

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "available",
  "best",
  "buy",
  "do",
  "find",
  "for",
  "get",
  "have",
  "in",
  "item",
  "items",
  "looking",
  "me",
  "need",
  "of",
  "please",
  "popular",
  "product",
  "products",
  "recommended",
  "seller",
  "sellers",
  "sale",
  "show",
  "some",
  "stock",
  "that",
  "the",
  "to",
  "want",
  "what",
  "which",
  "with",
  "you",
]);

const PRICE_CLAUSE =
  /\b(?:under|below|less\s+than|up\s+to|over|above|more\s+than|at\s+least)\s*\$?\s*[\d,]+(?:\.\d+)?\b/gi;
const SEARCH_INTENT_WORDS =
  /\b(?:affordable|budget|cheap|cheapest|highest|lowest|new|newest|latest|recent|expensive)\b/gi;

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
  const searchableText = String(value || "")
    .replace(PRICE_CLAUSE, " ")
    .replace(SEARCH_INTENT_WORDS, " ");
  return normalizeSearchText(searchableText)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
};

const compact = (value) => normalizeSearchText(value).replaceAll(" ", "");

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

const consecutivePhrases = (tokens, maximumWords = 5) => {
  const phrases = [];
  for (let start = 0; start < tokens.length; start += 1) {
    let compactText = "";
    const words = [];
    for (
      let end = start;
      end < tokens.length && end < start + maximumWords;
      end += 1
    ) {
      words.push(tokens[end]);
      compactText += tokens[end];
      if (compactText.length >= 3) {
        phrases.push({ compact: compactText, text: words.join(" ") });
      }
    }
  }
  return phrases;
};

const searchPhrases = (product) => {
  const primaryTokens = tokenize(
    `${product.name || ""} ${product.sku || ""} ${product.metal || ""} ${
      product.category || ""
    }`,
  );
  return consecutivePhrases(primaryTokens);
};

const bestPhraseMatch = (queryCompact, phrases) => {
  if (queryCompact.length < 4) return null;

  let best = null;
  for (const phrase of phrases) {
    const longest = Math.max(queryCompact.length, phrase.compact.length);
    const limit = Math.max(1, Math.ceil(longest * 0.36));
    if (Math.abs(queryCompact.length - phrase.compact.length) > limit) continue;
    const distance = boundedDamerauLevenshtein(
      queryCompact,
      phrase.compact,
      limit,
    );
    if (distance > limit) continue;
    const similarity = 1 - distance / longest;
    if (!best || similarity > best.similarity) {
      best = { ...phrase, similarity };
    }
  }
  return best;
};

const productIndexCache = new WeakMap();

const productSearchIndex = (product) => {
  const cached = productIndexCache.get(product);
  if (cached) return cached;

  const index = {
    candidates: weightedTokens(product),
    phrases: searchPhrases(product),
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

  const { candidates, phrases, normalizedName, normalizedSku, normalizedPrimary } =
    productSearchIndex(product);
  if (!candidates.length) return null;

  let score = 0;
  let unmatchedTokens = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(
        best,
        tokenMatchScore(queryToken, candidate.token) * candidate.weight,
      );
    }
    if (!best) unmatchedTokens += 1;
    else score += best;
  }

  const normalizedQuery = queryTokens.join(" ");
  const compactQuery = compact(normalizedQuery);
  const phraseMatch = bestPhraseMatch(compactQuery, phrases);

  // Phrase comparison rescues searches such as "golbuflo" or "goldbuffalo"
  // without maintaining a hand-written list of possible mistakes.
  if (unmatchedTokens && (!phraseMatch || phraseMatch.similarity < 0.64)) {
    return null;
  }
  if (phraseMatch?.similarity >= 0.64) {
    score += phraseMatch.similarity * 420 - unmatchedTokens * 30;
  }

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

const priceFromMatch = (match) => {
  if (!match?.[1]) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
};

export function understandSearchQuery(query) {
  const raw = String(query || "").toLowerCase();
  const maximumMatch = raw.match(
    /\b(?:under|below|less\s+than|up\s+to)\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
  );
  const minimumMatch = raw.match(
    /\b(?:over|above|more\s+than|at\s+least)\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
  );
  const wantsLowestPrice =
    /\b(?:affordable|budget|cheap|cheapest|lowest)\b/i.test(raw);
  const wantsHighestPrice = /\b(?:expensive|highest)\b/i.test(raw);

  return {
    terms: tokenize(query).join(" "),
    inStock: /\b(?:in\s+stock|available)\b/i.test(raw),
    featured: /\b(?:best|best\s*seller|popular|recommended)\b/i.test(raw),
    newest: /\b(?:new|newest|latest|recent)\b/i.test(raw),
    maximumPrice: priceFromMatch(maximumMatch),
    minimumPrice: priceFromMatch(minimumMatch),
    sort:
      wantsLowestPrice && !wantsHighestPrice
        ? "price-low"
        : wantsHighestPrice
          ? "price-high"
          : null,
  };
}

export function searchProducts(products, query, limit = Infinity) {
  if (!String(query || "").trim()) return products.slice(0, limit);
  return products
    .map((product) => ({ product, score: productSearchScore(product, query) }))
    .filter(({ score }) => score !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.product.is_featured) - Number(left.product.is_featured) ||
        String(left.product.name || "").localeCompare(
          String(right.product.name || ""),
        ),
    )
    .slice(0, limit)
    .map(({ product }) => product);
}

const catalogVocabularyCache = new WeakMap();

const catalogVocabulary = (products) => {
  const cached = catalogVocabularyCache.get(products);
  if (cached) return cached;

  const words = new Map();
  const phrases = [];
  for (const product of products) {
    const index = productSearchIndex(product);
    for (const candidate of index.candidates) {
      if (candidate.token.length < 3 && !/^\d+$/.test(candidate.token)) continue;
      words.set(
        candidate.token,
        (words.get(candidate.token) || 0) + candidate.weight,
      );
    }
    phrases.push(...index.phrases.filter((phrase) => phrase.text.includes(" ")));
  }

  const vocabulary = {
    words: [...words.entries()].map(([word, weight]) => ({ word, weight })),
    wordSet: new Set(words.keys()),
    phrases,
  };
  catalogVocabularyCache.set(products, vocabulary);
  return vocabulary;
};

const correctedCatalogWord = (queryWord, vocabulary) => {
  if (vocabulary.wordSet.has(queryWord) || /^\d+$/.test(queryWord)) {
    return queryWord;
  }
  if (queryWord.length < 3) return queryWord;

  const allowedDistance = queryWord.length <= 5 ? 1 : queryWord.length <= 8 ? 2 : 3;
  let best = null;
  for (const candidate of vocabulary.words) {
    if (Math.abs(queryWord.length - candidate.word.length) > allowedDistance)
      continue;
    const distance = boundedDamerauLevenshtein(
      queryWord,
      candidate.word,
      allowedDistance,
    );
    if (distance > allowedDistance) continue;
    const similarity = 1 - distance / Math.max(queryWord.length, candidate.word.length);
    const rank = similarity + Math.min(candidate.weight / 80, 0.12);
    if (!best || rank > best.rank) best = { word: candidate.word, rank };
  }
  return best?.word || queryWord;
};

export function suggestSearchCorrection(products, query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !products.length) return null;

  const vocabulary = catalogVocabulary(products);
  const correctedTokens = queryTokens.map((token) =>
    correctedCatalogWord(token, vocabulary),
  );
  const normalizedQuery = queryTokens.join(" ");
  const correctedQuery = correctedTokens.join(" ");
  if (correctedQuery !== normalizedQuery) return correctedQuery;

  // A one-word search can actually be several words run together. Compare it
  // with phrases learned from product titles (for example "goldbuffalo").
  if (queryTokens.length === 1 && queryTokens[0].length >= 5) {
    const phraseMatch = bestPhraseMatch(queryTokens[0], vocabulary.phrases);
    if (
      phraseMatch?.similarity >= 0.68 &&
      phraseMatch.text !== normalizedQuery
    ) {
      return phraseMatch.text;
    }
  }

  return null;
}
