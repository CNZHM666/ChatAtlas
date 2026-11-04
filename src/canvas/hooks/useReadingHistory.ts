import { useCallback, useEffect, useState } from "react";
import { listRecentReading, type ReadingProgress } from "../../storage/reading-progress";

export function useReadingHistory() {
  const [recent, setRecent] = useState<ReadingProgress[]>([]);
  const refresh = useCallback(() => { void listRecentReading().then(setRecent).catch(() => undefined); }, []);
  useEffect(refresh, [refresh]);
  return { recent, refresh };
}
