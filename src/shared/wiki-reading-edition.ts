import type { WikiWritingMode } from "./wiki-knowledge";
import type { FocusSection } from "./focus-session";
import type { WikiClaim } from "./wiki-claims";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { withoutEmptyWikiHeadings } from "./wiki-editorial-cleanup";
import { wikiTableCells } from "./wiki-table-source";

export type WikiEdition = "brief" | "handoff" | "archive";

export function wikiExportEdition(mode?: WikiEdition | WikiWritingMode): WikiEdition | undefined {
  return mode === "concise" ? "brief" : mode === "audit" ? "archive" : mode;
}

const HISTORY = /^(?:早先版本|此前(?:方案|版本)|讨论记录|讨论与历史|此前讨论|参考示例|Earlier versions|Discussion records|Discussion and history|Reference examples)$/iu;
const PROPOSED = /^(?:\*\*)?(?:AI\s*建议|讨论中的建议|一份提案(?:指出|建议|提出)|一项提案|一份分析(?:指出|建议)|此前曾(?:讨论|建议)|AI proposal|Proposal from the discussion)[：:，,\s]*/iu;
const DECISION = /(?:^|[。！？.]\s*)(?:当前决定|已确认|已定|待核对)[：:]\s*/u;
const plain = (text: string) => text.replace(/[\s*]/gu, "").replace(/[。.!?！？]$/u, "");
const bound = (text: string, claims: readonly WikiClaim[]) => claims.filter(claim => !claim.markOnly
  && [claim.text, ...claim.formulations ?? []].some(form => form && plain(text).includes(plain(form))));
const supplemental = (claim: WikiClaim) => claim.holder === "ai" || claim.holder === "earlier" || claim.holder === "material";
const executable = (claim: WikiClaim) => claim.holder === "open" || claim.userDecided && claim.holder !== "earlier"
  || claim.holder === "decided" && claim.verification === "supported";

export function wikiChapterEdition(section: FocusSection, edition: WikiEdition, sourceTables: ReadonlySet<string> = new Set()): FocusSection {
  if (edition === "archive" || section.userEdited || section.origin) return section;
  const claims = section.claims ?? [];
  const blocks = wikiDocumentBlocks(section.body);
  const retained: string[] = [], keptClaims = new Set<WikiClaim>();
  let historyLevel = 0;
  let briefSize=0;
  const main = (text: string, points: readonly WikiClaim[]) => {
    if(edition==="brief"&&briefSize+text.length>850)return;
    retained.push(text);
    briefSize+=text.length;
    points.forEach(claim=>keptClaims.add(claim));
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      const heading = block.text.match(/^(#+)\s+(.+)$/u);
      if (!heading) { retained.push(block.text); continue; }
      if (historyLevel && heading[1].length <= historyLevel) historyLevel = 0;
      if (HISTORY.test(heading[2].trim())) historyLevel = heading[1].length;
      if (!historyLevel) retained.push(block.text);
      continue;
    }
    const points = bound(block.text, claims);
    if (!historyLevel && edition === "handoff" && block.kind === "table" && sourceTables.has(block.text)) {
      main(block.text, points.filter(executable));
      continue;
    }
    const sentences=block.kind==="paragraph"?block.text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)/u).map(text=>text.trim()).filter(Boolean):[];
    if (historyLevel || (points.length ? points.every(supplemental) && !DECISION.test(block.text)
      && (!sentences.length||sentences.every(text=>bound(text,points).length||PROPOSED.test(text))) : PROPOSED.test(block.text))) continue;
    if (block.kind === "table") {
      const [header, separator, ...rows] = block.text.split("\n");
      const rowPoints: WikiClaim[]=[];
      const selected = rows.filter(row => {
        const rowClaims = bound(row, points);
        if (!rowClaims.length || !rowClaims.every(executable)) return false;
        const cells=wikiTableCells(row);
        if(cells.slice(1).some(cell=>cell.trim()&&!rowClaims.some(claim=>
          plain(claim.text).includes(plain(cell))||claim.text.trim()===cell.trim())))return false;
        rowPoints.push(...rowClaims);
        return true;
      });
      if (selected.length) main([header, separator, ...selected].join("\n"),rowPoints);
      continue;
    }
    if (sentences.length > 1) {
      // A self-contained clause can be separated from its peers. Keep the
      // enclosing paragraph when the model bound only part of a sentence.
      const separated = sentences.map(text => ({ text, points: bound(text, points) }));
      if (separated.length > 1 && points.every(claim => separated.some(piece => piece.points.includes(claim)))) {
        const primary = separated.filter(piece => piece.points.length && piece.points.every(executable));
        if (primary.length) main(primary.map(piece => piece.text).join(/\p{Script=Han}/u.test(block.text) ? "" : " "),primary.flatMap(piece=>piece.points));
        continue;
      }
    }
    if (!points.length || !points.every(executable)) continue;
    main(block.text,points);
  }
  const body = withoutEmptyWikiHeadings(retained.join("\n\n"));
  const visible = [...keptClaims];
  return { ...section, body, claims: visible, evidenceIds: [...new Set(visible.flatMap(claim => claim.evidenceIds))] };
}
