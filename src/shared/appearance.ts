/** Saved appearance is explicit; a new installation always starts light. */
export function preferredTheme():"light"|"dark" {
 return localStorage.getItem("atlas-theme")==="dark"?"dark":"light";
}
