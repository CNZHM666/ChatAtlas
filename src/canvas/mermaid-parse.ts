export interface MermaidFlowNode {
  id: string;
  label: string;
  shape: "rect" | "round" | "diamond";
}

export interface MermaidFlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface ParsedFlowchart {
  kind: "flowchart";
  direction: "TD" | "LR";
  nodes: MermaidFlowNode[];
  edges: MermaidFlowEdge[];
}

export interface MermaidErEntity {
  id: string;
  fields: Array<{ type: string; name: string; key?: string }>;
}

export interface MermaidErRelation {
  from: string;
  to: string;
  label: string;
  cardinality: string;
}

export interface ParsedErDiagram {
  kind: "erDiagram";
  entities: MermaidErEntity[];
  relations: MermaidErRelation[];
}

export type ParsedMermaid = ParsedFlowchart | ParsedErDiagram;

const cleanLabel = (raw: string) =>
  raw.trim().replace(/^["'`]|["'`]$/gu, "").replace(/<br\s*\/?>/giu, " / ").replace(/\s+/gu, " ").trim();

function parseNodeToken(token: string): MermaidFlowNode | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const shapes: Array<{ re: RegExp; shape: MermaidFlowNode["shape"] }> = [
    { re: /^([A-Za-z_][\w-]*)\s*\{\{?\s*([\s\S]+?)\s*\}?\}$/u, shape: "diamond" },
    { re: /^([A-Za-z_][\w-]*)\s*\(\(\s*([\s\S]+?)\s*\)\)$/u, shape: "round" },
    { re: /^([A-Za-z_][\w-]*)\s*\(\s*([\s\S]+?)\s*\)$/u, shape: "round" },
    { re: /^([A-Za-z_][\w-]*)\s*\[\s*([\s\S]+?)\s*\]$/u, shape: "rect" },
  ];
  for (const { re, shape } of shapes) {
    const match = re.exec(trimmed);
    if (match) return { id: match[1], label: cleanLabel(match[2]) || match[1], shape };
  }
  if (/^[A-Za-z_][\w-]*$/u.test(trimmed)) return { id: trimmed, label: trimmed, shape: "rect" };
  return undefined;
}

export function parseMermaidDiagram(source: string): ParsedMermaid | undefined {
  const lines = source
    .split(/\r?\n/u)
    .map(line => line.replace(/%%.*$/u, "").trim())
    .filter(Boolean);
  if (lines.length < 2) return undefined;

  const head = lines[0];
  const flowMatch = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/iu.exec(head);
  if (flowMatch) {
    const dirRaw = flowMatch[1].toUpperCase();
    const direction: "TD" | "LR" = dirRaw === "LR" || dirRaw === "RL" ? "LR" : "TD";
    const nodeMap = new Map<string, MermaidFlowNode>();
    const edges: MermaidFlowEdge[] = [];
    const register = (node: MermaidFlowNode) => {
      const existing = nodeMap.get(node.id);
      if (!existing) nodeMap.set(node.id, node);
      else if (existing.label === existing.id && node.label !== node.id) nodeMap.set(node.id, node);
      else if (existing.shape === "rect" && node.shape !== "rect") nodeMap.set(node.id, { ...existing, shape: node.shape, label: node.label || existing.label });
    };

    for (const line of lines.slice(1)) {
      if (/^(?:subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/iu.test(line)) continue;
      const cleaned = line.replace(/;$/u, "").trim();
      const arrowRe = /\s*(--+>|-\.+->|==+>|---)\s*(?:\|([^|]+)\|\s*)?|\s*--\s+([^-][^>]*?)\s+-->\s*/gu;
      const matches = [...cleaned.matchAll(arrowRe)];
      if (!matches.length) {
        const single = parseNodeToken(cleaned);
        if (single) register(single);
        continue;
      }
      let cursor = 0;
      const segments: Array<{ token: string; edgeLabel?: string; dashed?: boolean }> = [];
      for (const match of matches) {
        const index = match.index ?? 0;
        const left = cleaned.slice(cursor, index).trim();
        const op = match[1] ?? "-->";
        const edgeLabel = match[2] ?? match[3];
        segments.push({ token: left, edgeLabel: edgeLabel ? cleanLabel(edgeLabel) : undefined, dashed: op.includes(".") });
        cursor = index + match[0].length;
      }
      const tail = cleaned.slice(cursor).trim();
      segments.push({ token: tail });
      for (let i = 0; i < segments.length - 1; i++) {
        const from = parseNodeToken(segments[i].token);
        const to = parseNodeToken(segments[i + 1].token);
        if (!from || !to) continue;
        register(from);
        register(to);
        edges.push({ from: from.id, to: to.id, label: segments[i].edgeLabel, dashed: segments[i].dashed });
      }
    }
    if (!nodeMap.size || (!edges.length && nodeMap.size < 2) || nodeMap.size > 28) return undefined;
    return { kind: "flowchart", direction, nodes: [...nodeMap.values()], edges };
  }

  if (/^erDiagram\b/iu.test(head)) {
    const entityMap = new Map<string, MermaidErEntity>();
    const relations: MermaidErRelation[] = [];
    const ensure = (id: string) => {
      if (!entityMap.has(id)) entityMap.set(id, { id, fields: [] });
      return entityMap.get(id)!;
    };
    let currentEntity: MermaidErEntity | undefined;
    for (const line of lines.slice(1)) {
      if (currentEntity) {
        if (line === "}") { currentEntity = undefined; continue; }
        const field = /^([\w<>[\]-]+)\s+([\w-]+)(?:\s+(PK|FK|UK))?/u.exec(line);
        if (field && currentEntity.fields.length < 6) currentEntity.fields.push({ type: field[1], name: field[2], key: field[3] });
        continue;
      }
      const blockOpen = /^([\w-]+)\s*\{$/u.exec(line);
      if (blockOpen) { currentEntity = ensure(blockOpen[1]); continue; }
      const rel = /^([\w-]+)\s+([|}o]{1,2}(?:--|\.\.)[|{o]{1,2})\s+([\w-]+)\s*:\s*(.+)$/u.exec(line);
      if (rel) {
        ensure(rel[1]);
        ensure(rel[3]);
        relations.push({ from: rel[1], to: rel[3], cardinality: rel[2], label: cleanLabel(rel[4]) });
      }
    }
    if (!entityMap.size || entityMap.size > 16) return undefined;
    return { kind: "erDiagram", entities: [...entityMap.values()], relations };
  }

  return undefined;
}
