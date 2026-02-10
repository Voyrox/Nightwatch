function toRegex(val) {
  if (val instanceof RegExp) return val;
  if (typeof val !== "string") return null;
  try {
    return new RegExp(val, "i");
  } catch {
    return null;
  }
}

module.exports = { toRegex };
