import { useCallback, useState } from "react";
import type { MessageAnchor } from "../../shared/types";
import { getDatabase } from "../../storage/db";
import { listReviewMarks, type ReviewMark } from "../../storage/review-marks";

export function useAtlasSearch() {
  const [open, setOpen] = useState(false);
  const [anchors, setAnchors] = useState<MessageAnchor[]>([]);
  const [marks, setMarks] = useState<ReviewMark[]>([]);
  const show = useCallback(() => {
    setOpen(true);
    void getDatabase().then((db) => db.getAll("anchors")).then(setAnchors).catch(() => setAnchors([]));
    void listReviewMarks().then(setMarks).catch(() => setMarks([]));
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { open, anchors, marks, show, close };
}
