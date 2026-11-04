/** Saved preferences take priority; a new installation starts in English. */
export function preferredOutputLocale(): "zh-CN" | "en" {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem("atlas-locale");
  if (saved === "zh-CN" || saved === "en") return saved;
  return "en";
}
