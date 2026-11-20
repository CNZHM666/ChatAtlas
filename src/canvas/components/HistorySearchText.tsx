import { Fragment, memo } from "react";
import { historySearchRanges, historySearchSnippet } from "../../search/history-search-display";

export const HistorySearchText = memo(function HistorySearchText({ text, query, limit }: { text: string; query: string; limit?: number }) {
  const display = historySearchSnippet(text, query, limit);
  let offset = 0;
  return <>{historySearchRanges(query, display).map(({ start, end }) => {
    const plain = display.slice(offset, start);
    offset = end;
    return <Fragment key={start}>{plain}<mark className="history-search-term">{display.slice(start, end)}</mark></Fragment>;
  })}{display.slice(offset)}</>;
});
