import type { FocusSection } from "../shared/focus-session";
import { diagramTextLines, type DiagramLayout } from "./diagram-layout";
import { understandingSummary } from "./understanding-summary";
const escape=(text:string)=>text.replace(/[<>&"']/gu,char=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[char]!));
/** Export the displayed geometry as inert SVG. No source HTML, scripts, remote
 * fonts or foreignObject; the complete text remains in the Wiki export. */
export function diagramSvg(layout:DiagramLayout,sections:FocusSection[],theme:{background:string;surface:string;text:string;muted:string;border:string}) {
 const color=Object.fromEntries(Object.entries(theme).map(([key,value])=>[key,escape(value)]));
 const labels=(lines:string[],x:number,y:number,fill:string,size:number)=>`<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" fill="${fill}">${lines.map((line,index)=>`<tspan x="${x}" dy="${index?20:0}">${escape(line)}</tspan>`).join("")}</text>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="system-ui, sans-serif"><title>ChatAtlas</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="${color.muted}"/></marker></defs><rect width="100%" height="100%" fill="${color.background}"/>`+
 layout.groups.map(group=>`<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="8" fill="none" stroke="${color.border}"/>${labels([group.title],group.x+group.width/2,group.y+24,color.muted,14)}`).join("")+
 layout.links.map(link=>link.paths.map(path=>`<path d="${escape(path)}" fill="none" stroke="${color.muted}" stroke-width="1.5" marker-end="url(#arrow)"/>`).join("")+link.labels.map(label=>`<rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="4" fill="${color.background}"/>${labels(label.lines,label.x+label.width/2,label.y+17,color.muted,14)}`).join("")).join("")+
 layout.nodes.map(node=>{const section=sections.find(section=>section.id===node.id);if(!section)return "";const lines=diagramTextLines(section.title,13),summary=understandingSummary(section);return `<g><title>${escape([section.title,summary].filter(Boolean).join(" — "))}</title><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${color.surface}" stroke="${color.border}"/>${labels(lines,node.x+node.width/2,node.y+26,color.text,15)}${summary&&summary!==section.title&&node.height>lines.length*22+48?labels(diagramTextLines(summary,16).slice(0,3),node.x+node.width/2,node.y+lines.length*22+36,color.muted,13):""}</g>`;}).join("")+"</svg>";
}
