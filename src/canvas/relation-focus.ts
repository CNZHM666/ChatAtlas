import type { KnowledgeCanvas } from "../shared/types";
import type { OverviewLink } from "../storage/knowledge-graph";
import type { Locale } from "./preferences";

export interface DomainRelation {
  sourceCanvasId: string;
  targetCanvasId: string;
  score: number;
  reason?: string;
  evidenceCount?: number;
}

// An embedding/LLM/hybrid scorer can replace the observed-link implementation later.
export interface RelationScorer {
  scoreRelations(domains: KnowledgeCanvas[]): Promise<DomainRelation[]>;
}

export function scoreObservedRelations(links: OverviewLink[], domainIds: Set<string>): DomainRelation[] {
  const strongest = Math.max(1, ...links.map((link) => link.strength));
  return links.filter((link) => domainIds.has(link.fromCanvasId) && domainIds.has(link.toCanvasId) && link.fromCanvasId !== link.toCanvasId)
    .map((link) => ({ sourceCanvasId: link.fromCanvasId, targetCanvasId: link.toCanvasId, score: Math.min(1, .25 + .7 * link.strength / strongest), evidenceCount: link.strength }));
}

export class ObservedRelationScorer implements RelationScorer {
  constructor(private readonly links: OverviewLink[]) {}
  async scoreRelations(domains: KnowledgeCanvas[]): Promise<DomainRelation[]> {
    return scoreObservedRelations(this.links, new Set(domains.map((domain) => domain.id)));
  }
}

const demoPairs: Array<[string, string, number]> = [
  ["automation", "coding", .92], ["automation", "ai", .84], ["automation", "control", .81],
  ["automation", "math", .63], ["automation", "embedded", .52], ["automation", "sensors", .43],
  ["coding", "ai", .88], ["coding", "math", .74], ["coding", "product", .69], ["coding", "embedded", .66],
  ["design", "product", .91], ["design", "creation", .82], ["study", "math", .78],
  ["study", "science", .75], ["study", "english", .61], ["reading", "english", .8],
  ["reading", "study", .71], ["life", "reading", .55], ["science", "math", .86],
  ["ai", "product", .55], ["control", "math", .72], ["control", "embedded", .67],
];

export const demoRelations: DomainRelation[] = demoPairs.map(([sourceCanvasId, targetCanvasId, score]) => ({ sourceCanvasId, targetCanvasId, score }));

export interface OrbPoint { id: string; x: number; y: number; depth: number; width: number }
export interface PositionedOrbPoint extends OrbPoint { opacity: number; scale: number; fontSize: number; hidden?: boolean }

export function relationVisual(score: number): { distance: number; scale: number; opacity: number; fontSize: number; lineOpacity: number } {
  const value = Math.max(0, Math.min(1, score));
  if (value >= .76) return { distance: 21 + (1 - value) * 16, scale: 1.04, opacity: .94, fontSize: 18, lineOpacity: .4 + value * .16 };
  if (value >= .45) return { distance: 30 + (.76 - value) * 16, scale: .96, opacity: .63 + (value - .45) * .28, fontSize: 15, lineOpacity: .22 + value * .16 };
  return { distance: 39, scale: .84, opacity: .26 + value * .3, fontSize: 13, lineOpacity: .1 };
}

function collides(a: PositionedOrbPoint, b: PositionedOrbPoint, diameter: number, spacing: number): boolean {
  const px = diameter / 100;
  const dx = Math.abs(a.x - b.x) * px;
  const dy = Math.abs(a.y - b.y) * px;
  return dx < (a.width + b.width) * spacing / 2 + 8 && dy < Math.max(a.fontSize, b.fontSize) * 1.5 + 8;
}

export function layoutOverview(points: OrbPoint[], diameter: number, locale: Locale): PositionedOrbPoint[] {
  const spacing = locale === "en" ? 1.25 : 1;
  const placed: PositionedOrbPoint[] = [];
  for (const point of points) {
    const fontSize = Math.round(12 + point.depth * (locale === "en" ? 5 : 6));
    const candidate: PositionedOrbPoint = { ...point, opacity: .25 + point.depth * .68, scale: .82 + point.depth * .2, fontSize };
    const fits = (x: number, y: number) => {
      const halfWidth = candidate.width * spacing / diameter * 50;
      const coreOverlap = Math.abs(x - 50) < (candidate.width * spacing / 2 + 81) / diameter * 100 && Math.abs(y - 50) < 15;
      return x - halfWidth >= 6 && x + halfWidth <= 94 && y >= 7 && y <= 93 && !coreOverlap
        && !placed.some((other) => collides({ ...candidate, x, y }, other, diameter, spacing));
    };
    if (!fits(candidate.x, candidate.y)) {
      search: for (let radius = 3; radius <= 39; radius += 3) for (let step = 0; step < 24; step++) {
        const angle = step / 24 * Math.PI * 2;
        const x = point.x + Math.cos(angle) * radius;
        const y = point.y + Math.sin(angle) * radius;
        if (fits(x, y)) { candidate.x = x; candidate.y = y; break search; }
      }
    }
    placed.push(candidate);
  }
  return placed;
}

export function layoutFocus(points: OrbPoint[], focusId: string, relations: DomainRelation[], diameter: number, locale: Locale): PositionedOrbPoint[] {
  const scores = new Map<string, number>();
  for (const relation of relations) {
    const other = relation.sourceCanvasId === focusId ? relation.targetCanvasId : relation.targetCanvasId === focusId ? relation.sourceCanvasId : null;
    if (other) scores.set(other, Math.max(scores.get(other) ?? 0, relation.score));
  }
  const ranked = points.filter((point) => point.id !== focusId && (scores.get(point.id) ?? 0) >= .2)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)).slice(0, 7);
  const angles = [-91, -146, -35, 146, 32, 92, -3];
  const spacing = locale === "en" ? 1.25 : 1;
  const placed: PositionedOrbPoint[] = [{ ...points.find((point) => point.id === focusId)!, x: 50, y: 50, opacity: 1, scale: 1.08, fontSize: 18 }];
  ranked.forEach((point, index) => {
    const visual = relationVisual(scores.get(point.id) ?? 0);
    const angle = angles[index] * Math.PI / 180;
    const candidate: PositionedOrbPoint = { ...point, x: 50 + Math.cos(angle) * visual.distance, y: 50 + Math.sin(angle) * visual.distance, opacity: visual.opacity, scale: visual.scale, fontSize: visual.fontSize };
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!placed.some((other) => collides(candidate, other, diameter, spacing))) break;
      candidate.x = Math.max(8, Math.min(92, candidate.x + Math.cos(angle) * 2));
      candidate.y = Math.max(8, Math.min(92, candidate.y + Math.sin(angle) * 2));
    }
    placed.push(candidate);
  });
  return points.map((point) => placed.find((item) => item.id === point.id) ?? { ...point, opacity: 0, scale: .76, fontSize: 13, hidden: true });
}
