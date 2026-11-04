import { useCallback, useState } from "react";

/** A new key: the earlier one remembered only turning the marks off, so the old default (shown) does not carry over. */
const KEY = "atlas-wiki-holder-marks-shown";
/** Source highlighting preference: off until the user turns it on, then remembered. Decided, open and earlier marks stay
 * visible when it is off; only whose words a sentence is (你, 资料) and its tint wait for the button. Shown by default, a
 * page read as a review sheet of tints and marks before anything else. */
export function useHolderMarks(): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const update = useCallback((value: boolean) => { setShown(value); try { if (value) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* The choice holds for this page only. */ } }, []);
  return [shown, update];
}
