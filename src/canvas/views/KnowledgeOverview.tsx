import { ArrowLeft, CircleHelp, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { AtlasCanvas, KnowledgeProposal } from "../../shared/types";
import { getKnowledgeOverview, type OverviewLink } from "../../storage/knowledge-graph";
import type { KnowledgeSpaceUiState } from "../atlas-status";
import { localizeKnowledgeCanvasTitle, shortDomainTitle } from "../knowledge-labels";
import { demoRelations, layoutFocus, layoutOverview, relationVisual, scoreObservedRelations, type OrbPoint } from "../relation-focus";
import { usePreferences, type Locale } from "../preferences";

interface OrbDomain { canvas: AtlasCanvas; cardCount: number; sourceCount: number; preview: boolean; x: number; y: number; depth: number }
interface DemoWord { id: string; label: Record<Locale, string>; x: number; y: number; depth: number; supplemental?: boolean }
interface DisplayNode extends OrbPoint { label: string; demo: boolean; supplemental: boolean; domain?: OrbDomain }

const demoWords: DemoWord[] = [
  { id: "math", label: { en: "Math", "zh-CN": "数学" }, x: 49, y: 10, depth: .72 },
  { id: "coding", label: { en: "Programming", "zh-CN": "编程" }, x: 72, y: 22, depth: .94 },
  { id: "design", label: { en: "Design", "zh-CN": "设计" }, x: 83, y: 44, depth: .58 },
  { id: "life", label: { en: "Life", "zh-CN": "生活" }, x: 75, y: 73, depth: .38 },
  { id: "english", label: { en: "English", "zh-CN": "英语" }, x: 53, y: 87, depth: .66 },
  { id: "study", label: { en: "Learning", "zh-CN": "学习" }, x: 28, y: 79, depth: .9 },
  { id: "product", label: { en: "Product", "zh-CN": "产品" }, x: 17, y: 59, depth: .52 },
  { id: "ai", label: { en: "AI", "zh-CN": "人工智能" }, x: 21, y: 29, depth: .82 },
  { id: "automation", label: { en: "Automation", "zh-CN": "自动化" }, x: 39, y: 28, depth: .55 },
  { id: "creation", label: { en: "Creative", "zh-CN": "创作" }, x: 69, y: 50, depth: .44 },
  { id: "science", label: { en: "Science", "zh-CN": "科学" }, x: 41, y: 68, depth: .56 },
  { id: "reading", label: { en: "Reading", "zh-CN": "阅读" }, x: 29, y: 49, depth: .76 },
  { id: "control", label: { en: "Control", "zh-CN": "控制理论" }, x: 50, y: 50, depth: .7, supplemental: true },
  { id: "embedded", label: { en: "Embedded", "zh-CN": "嵌入式" }, x: 50, y: 50, depth: .6, supplemental: true },
  { id: "sensors", label: { en: "Sensors", "zh-CN": "传感器" }, x: 50, y: 50, depth: .5, supplemental: true },
];

const realSlots = [
  [50, 11, .8], [72, 23, .93], [82, 46, .58], [73, 73, .66], [51, 86, .75],
  [27, 77, .88], [18, 54, .5], [26, 27, .72], [39, 29, .45], [67, 55, .6],
];

function measuredWidth(label: string, locale: Locale): number {
  if (typeof OffscreenCanvas !== "undefined") {
    const context = new OffscreenCanvas(1, 1).getContext("2d");
    if (context) { context.font = `${locale === "en" ? 500 : 550} 16px sans-serif`; return context.measureText(label).width; }
  }
  return [...label].reduce((width, character) => width + (/\p{Script=Han}/u.test(character) ? 16 : 8), 0);
}

function spreadOnboardingPosition(x: number, y: number, diameter: number): { x: number; y: number } {
  const dx = x - 50;
  const dy = y - 50;
  const radius = Math.hypot(dx, dy);
  if (!radius) return { x, y };
  const coreRadius = Math.min(76, Math.max(62, diameter * .25));
  const minimumRadius = Math.max(26, Math.min(34, (coreRadius + 24) / Math.max(diameter, 1) * 100));
  const spread = Math.min(42, Math.max(radius * 1.12, minimumRadius)) / radius;
  const clamp = (value: number) => Math.max(8, Math.min(92, value));
  return { x: clamp(50 + dx * spread), y: clamp(50 + dy * spread) };
}

interface KnowledgeOverviewProps {
  canvases: AtlasCanvas[];
  recentReading?: Array<{ canvasId: string; cardId: string; messageId?: string; title: string; spaceTitle: string; updatedAt: number }>;
  onResume?: (entry: { canvasId: string; cardId: string; messageId?: string }) => void;
  proposal: KnowledgeProposal | null;
  uiState: KnowledgeSpaceUiState;
  onSelect: (canvasId: string) => void;
  onStartSync: () => void;
  onStartCreate: () => void;
  onImportFile?: (file: File) => void;
  onRetrySync: () => void;
  onReconnect: () => void;
  onViewDetails: () => void;
}

export function KnowledgeOverview({ canvases, recentReading = [], onResume, proposal, uiState, onSelect, onStartSync, onStartCreate, onImportFile, onRetrySync, onReconnect, onViewDetails }: KnowledgeOverviewProps) {
  const { locale, t } = usePreferences();
  const rootRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const parallaxFrame = useRef<number | null>(null);
  const demoFocusSeen = useRef(false);
  const [orbDiameter, setOrbDiameter] = useState(620);
  const [snapshot, setSnapshot] = useState<{ domains: Array<{ canvasId: string; cardCount: number; sourceCount: number }>; links: OverviewLink[] }>({ domains: [], links: [] });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showFocusHint, setShowFocusHint] = useState(false);
  const [showImportGuide, setShowImportGuide] = useState(false);
  const guideCloseRef = useRef<HTMLButtonElement>(null);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");

  useEffect(() => { void getKnowledgeOverview().then(setSnapshot); }, [canvases, proposal?.id]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setOrbDiameter(Math.round(entries[0]?.contentRect.width ?? 620)));
    if (orbRef.current) observer.observe(orbRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const visibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => () => { if (parallaxFrame.current !== null) cancelAnimationFrame(parallaxFrame.current); }, []);
  useEffect(() => { if (!showFocusHint) return; const timer = window.setTimeout(() => setShowFocusHint(false), 3400); return () => window.clearTimeout(timer); }, [showFocusHint]);
  useEffect(() => {
    if (!showImportGuide) return;
    guideCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowImportGuide(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showImportGuide]);

  const topics = useMemo(() => {
    const domainIds = new Set(snapshot.domains.map((domain) => domain.canvasId));
    const proposalDomainIds = new Set(proposal?.memberships.map((membership) => membership.canvasId) ?? []);
    const committed = canvases.filter((canvas) => canvas.type !== "overview" && (domainIds.has(canvas.id) || proposalDomainIds.has(canvas.id)));
    const preview = (proposal?.canvases ?? []).map((canvas) => ({ ...canvas, name: canvas.title }));
    return [...committed, ...preview.filter((canvas) => !committed.some((item) => item.id === canvas.id))];
  }, [canvases, proposal, snapshot.domains]);
  const domains = useMemo<OrbDomain[]>(() => topics.map((canvas) => {
    const data = snapshot.domains.find((item) => item.canvasId === canvas.id);
    const memberships = proposal?.memberships.filter((item) => item.canvasId === canvas.id) ?? [];
    const cardIds = new Set(memberships.map((item) => item.cardId));
    const sources = new Set(proposal?.sources.filter((source) => cardIds.has(source.cardId)).map((source) => source.conversationId) ?? []).size;
    return { canvas, cardCount: (data?.cardCount ?? 0) + memberships.length, sourceCount: (data?.sourceCount ?? 0) + sources, preview: Boolean(memberships.length || proposal?.canvases.some((item) => item.id === canvas.id)) };
  }).sort((a, b) => b.sourceCount - a.sourceCount || b.cardCount - a.cardCount).slice(0, 10)
    .map((domain, index) => ({ ...domain, x: realSlots[index][0], y: realSlots[index][1], depth: realSlots[index][2] })), [topics, snapshot.domains, proposal]);

  const showingReal = uiState.phase === "organized" || Boolean(proposal && domains.length);
  const nodes = useMemo<DisplayNode[]>(() => showingReal
    ? domains.map((domain) => ({ id: domain.canvas.id, label: localizeKnowledgeCanvasTitle(domain.canvas.title ?? domain.canvas.name, locale), x: domain.x, y: domain.y, depth: domain.depth, width: 0, demo: false, supplemental: false, domain }))
    : demoWords.map((word) => ({ id: word.id, label: word.label[locale], x: word.x, y: word.y, depth: word.depth, width: 0, demo: true, supplemental: Boolean(word.supplemental) })), [showingReal, domains, locale]);
  const measuredNodes = useMemo(() => nodes.map((node) => ({ ...node, width: measuredWidth(node.demo ? node.label : shortDomainTitle(node.label, locale), locale) })), [nodes, locale]);
  const realLinks = useMemo(() => {
    const strengths = new Map<string, number>();
    const add = (from: string, to: string, strength: number) => {
      if (from === to) return;
      const key = [from, to].sort().join("|");
      strengths.set(key, (strengths.get(key) ?? 0) + strength);
    };
    snapshot.links.forEach((link) => add(link.fromCanvasId, link.toCanvasId, link.strength));
    if (proposal) {
      const cardCanvases = new Map<string, string[]>();
      for (const membership of proposal.memberships) cardCanvases.set(membership.cardId, [...cardCanvases.get(membership.cardId) ?? [], membership.canvasId]);
      for (const relation of proposal.relations) for (const from of cardCanvases.get(relation.fromCardId) ?? []) for (const to of cardCanvases.get(relation.toCardId) ?? []) add(from, to, 1);
    }
    return [...strengths].map(([key, strength]) => { const [fromCanvasId, toCanvasId] = key.split("|"); return { fromCanvasId, toCanvasId, strength }; });
  }, [snapshot.links, proposal]);
  const relations = useMemo(() => showingReal ? scoreObservedRelations(realLinks, new Set(measuredNodes.map((node) => node.id))) : demoRelations, [showingReal, realLinks, measuredNodes]);
  const overview = useMemo(() => layoutOverview(measuredNodes.filter((node) => !node.supplemental), orbDiameter, locale), [measuredNodes, orbDiameter, locale]);
  const activeFocus = focusId && measuredNodes.some((node) => node.id === focusId) ? focusId : null;
  const focus = useMemo(() => activeFocus ? layoutFocus(measuredNodes, activeFocus, relations, orbDiameter, locale) : [], [measuredNodes, activeFocus, relations, orbDiameter, locale]);
  const placed = useMemo(() => new Map((activeFocus ? focus : overview).map((node) => [node.id, node])), [activeFocus, focus, overview]);
  const focusRelations = useMemo(() => !activeFocus ? [] : relations.filter((relation) => (relation.sourceCanvasId === activeFocus || relation.targetCanvasId === activeFocus) && relation.score >= .2)
    .sort((a, b) => b.score - a.score).slice(0, 7), [activeFocus, relations]);
  const relatedToHovered = new Set(relations.flatMap((relation) => relation.sourceCanvasId === hovered ? [relation.targetCanvasId] : relation.targetCanvasId === hovered ? [relation.sourceCanvasId] : []));

  const openFocus = (id: string) => {
    if (activeFocus === id) { if (showingReal) onSelect(id); return; }
    resetParallax(); setFocusId(id); setHovered(null);
    if (!showingReal && !demoFocusSeen.current) { demoFocusSeen.current = true; setShowFocusHint(true); }
  };
  const returnOverview = () => { setFocusId(null); setHovered(null); setShowFocusHint(false); };
  const move = (event: MouseEvent<HTMLDivElement>) => {
    if (activeFocus || window.matchMedia("(prefers-reduced-motion: reduce)").matches || parallaxFrame.current !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    parallaxFrame.current = requestAnimationFrame(() => {
      rootRef.current?.style.setProperty("--pointer-x", String(x));
      rootRef.current?.style.setProperty("--pointer-y", String(y));
      parallaxFrame.current = null;
    });
  };
  const resetParallax = () => { rootRef.current?.style.setProperty("--pointer-x", "0"); rootRef.current?.style.setProperty("--pointer-y", "0"); };
  const hasImportedConversations = uiState.sync.completed > 0;
  const importing = uiState.sync.state === "syncing" && !showingReal;
  const readyToCreate = (uiState.phase === "demo_synced_ready" || uiState.phase === "demo_partial_ready") && uiState.sync.completed > 0;
  const onboardingActive = importing || readyToCreate;
  const syncTotal = Math.max(uiState.sync.discovered, uiState.sync.completed);
  const syncCompleted = Math.min(uiState.sync.completed, syncTotal);
  useEffect(() => {
    if (onboardingActive) { setFocusId(null); setShowFocusHint(false); }
  }, [onboardingActive]);
  const orbPositions = useMemo(() => {
    if (!onboardingActive || showingReal || activeFocus) return placed;
    return new Map([...placed].map(([id, position]) => [id, { ...position, ...spreadOnboardingPosition(position.x, position.y, orbDiameter) }]));
  }, [onboardingActive, showingReal, activeFocus, placed, orbDiameter]);
  const showBottomState = !activeFocus && (uiState.phase === "demo_idle" || uiState.phase === "sync_failed" || uiState.phase === "auth_required" && !hasImportedConversations);
  return <><div ref={rootRef} className={`knowledge-overview locale-${locale === "en" ? "en" : "zh"} phase-${uiState.phase} ${showingReal ? "is-ready" : "is-demo"} ${onboardingActive ? "is-onboarding-active" : ""} ${activeFocus ? "has-focus" : ""} ${hovered ? "has-hover" : ""} ${pageVisible ? "" : "is-paused"}`} onMouseMove={move} onMouseLeave={resetParallax}>
    {recentReading.length && !onboardingActive ? <section className="overview-recent-reading" aria-label={locale === "zh-CN" ? "继续阅读" : "Continue reading"}><h2>{locale === "zh-CN" ? "继续阅读" : "Continue reading"}</h2>{recentReading.slice(0, 3).map((entry) => <button key={`${entry.canvasId}:${entry.cardId}`} onClick={() => onResume?.(entry)}><strong>{entry.title}</strong><small>{entry.spaceTitle}</small></button>)}</section> : null}
    <div className="knowledge-hero-group">
      <div ref={orbRef} className={`knowledge-orb ${showingReal ? "real-orb" : "demo-orb"} ${uiState.phase === "organizing" ? "is-organizing" : ""} ${proposal ? "is-forming" : ""}`} onClick={(event) => { if (activeFocus && (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains("orb-atmosphere"))) returnOverview(); }}>
        <div className="orb-atmosphere" />
        {activeFocus ? <button className="focus-back" onClick={returnOverview}><ArrowLeft size={14} />{t("overviewLabel")}</button> : null}
        <svg className={`orb-links ${activeFocus ? "focus-links" : ""}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {activeFocus ? focusRelations.map((relation) => {
            const otherId = relation.sourceCanvasId === activeFocus ? relation.targetCanvasId : relation.sourceCanvasId;
            const target = orbPositions.get(otherId);
            if (!target || target.hidden) return null;
            const visual = relationVisual(relation.score);
            return <line key={otherId} x1="50" y1="50" x2={target.x} y2={target.y} style={{ opacity: hovered && hovered !== otherId ? .08 : hovered === otherId ? .7 : visual.lineOpacity, strokeWidth: hovered === otherId ? .24 : .1 + relation.score * .12 } as CSSProperties} />;
          }) : relations.filter((relation) => !showingReal || relation.score >= .45).slice(0, showingReal ? 6 : 3).map((relation) => {
            const from = orbPositions.get(relation.sourceCanvasId); const to = orbPositions.get(relation.targetCanvasId);
            if (!from || !to) return null;
            const highlighted = hovered === relation.sourceCanvasId || hovered === relation.targetCanvasId;
            return <line key={`${relation.sourceCanvasId}:${relation.targetCanvasId}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={{ opacity: highlighted ? .4 : hovered ? .025 : showingReal ? .08 + relation.score * .12 : .045, strokeWidth: highlighted ? .17 : .08 }} />;
          })}
        </svg>
        <div className={`orb-core ${activeFocus ? "is-hidden" : ""}`}><Sparkles size={20} /><strong>{t("knowledgeSeedTitle")}</strong>{showingReal ? <span>{t(domains.length === 1 ? "domainCountOne" : "domainCount", { count: domains.length })}</span> : null}</div>
        {measuredNodes.map((node, index) => {
          const position = orbPositions.get(node.id);
          const hidden = !position || position.hidden || (uiState.phase === "organizing" && !showingReal);
          const muted = !activeFocus && Boolean(hovered && hovered !== node.id && !relatedToHovered.has(node.id));
          const domain = node.domain;
          const displayTitle = node.demo ? node.label : shortDomainTitle(node.label, locale);
          return <button key={node.id} className={`orb-node ${node.demo ? "is-demo-node" : "is-real-node"} ${activeFocus === node.id ? "is-focus-node" : ""} ${domain?.preview ? "is-preview" : ""} ${muted ? "is-muted" : ""} ${hidden ? "is-hidden" : ""}`} style={{ left: `${position?.x ?? node.x}%`, top: `${position?.y ?? node.y}%`, opacity: hidden ? 0 : muted ? .14 : position?.opacity ?? 0, "--node-scale": position?.scale ?? .75, "--node-size": `${position?.fontSize ?? 14}px`, "--node-index": index } as CSSProperties} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onClick={(event) => { event.stopPropagation(); if (!onboardingActive) openFocus(node.id); }} title={displayTitle !== node.label ? node.label : activeFocus === node.id && !node.demo ? t("openDomainCanvas") : node.demo ? t("demoWordHint") : undefined} aria-label={node.label} aria-hidden={hidden || onboardingActive} tabIndex={hidden || onboardingActive ? -1 : 0}>
            <span className="orb-node-title">{displayTitle}</span>
            {domain && !activeFocus ? <small>{domain.sourceCount ? t(domain.sourceCount === 1 ? "domainSourceCountOne" : "domainSourceCount", { count: domain.sourceCount }) : domain.cardCount ? t(domain.cardCount === 1 ? "conceptCountOne" : "conceptCount", { count: domain.cardCount }) : t("waitingToBuild")}</small> : null}
          </button>;
        })}
        {showFocusHint && activeFocus && !showingReal ? <div className="demo-focus-hint">{t("demoFocusHint")}</div> : null}
      </div>

      {onboardingActive ? <section className={`knowledge-onboarding-state ${readyToCreate ? "knowledge-onboarding-ready" : ""}`} aria-label={importing ? locale === "zh-CN" ? "导入进度" : "Import progress" : locale === "zh-CN" ? "可以开始整理" : "Ready to organize"}>
        <strong className="knowledge-import-count">{readyToCreate ? locale === "zh-CN" ? `${syncCompleted} 条可用` : `${syncCompleted} ready` : importing && syncTotal ? `${syncCompleted} / ${syncTotal}` : locale === "zh-CN" ? "正在同步…" : "Syncing…"}</strong>
        {importing && syncTotal > 0 ? <div className="knowledge-import-progress" role="progressbar" aria-label={locale === "zh-CN" ? "对话导入进度" : "Conversation import progress"} aria-valuemin={0} aria-valuemax={syncTotal} aria-valuenow={syncCompleted}>
          <span style={{ width: `${syncCompleted / syncTotal * 100}%` }} />
        </div> : null}
        {readyToCreate ? <button className="primary" onClick={onStartCreate}>{locale === "zh-CN" ? "创建知识空间 →" : "Create Knowledge Space →"}</button> : null}
      </section> : null}
      {showBottomState ? <div className="knowledge-state" aria-live="polite">
        {uiState.phase === "demo_idle" ? <><strong>{t("demoIdleTitle")}</strong><div className="knowledge-import-actions"><button className="primary" onClick={() => importFileRef.current?.click()}>{t("importDataFile")}</button><button onClick={onStartSync}>{t("directSyncChatGPT")}</button><button className="knowledge-import-help" onClick={() => setShowImportGuide(true)} aria-label={t("importGuideOpen")} title={t("importGuideOpen")}><CircleHelp size={18} /></button></div><input ref={importFileRef} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportFile?.(file); event.currentTarget.value = ""; }} /></> : null}
        {uiState.phase === "auth_required" ? <><strong>{t("authRequiredTitle")}</strong><button className="primary" onClick={onReconnect}>{t("reconnect")}</button></> : null}
        {uiState.phase === "sync_failed" ? <><strong>{t("syncFailedTitle")}</strong><div><button className="primary" onClick={onRetrySync}>{t("retry")}</button><button onClick={onViewDetails}>{t("viewDetails")}</button></div></> : null}
      </div> : null}
    </div>
  </div>{showImportGuide ? createPortal(<div className="knowledge-import-guide-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowImportGuide(false); }}><section className="knowledge-import-guide" role="dialog" aria-modal="true" aria-labelledby="knowledge-import-guide-title"><header><h2 id="knowledge-import-guide-title">{t("importGuideTitle")}</h2><button ref={guideCloseRef} onClick={() => setShowImportGuide(false)} aria-label={t("close")}><X size={18} /></button></header><ol><li><strong>{t("importGuideStep1Title")}</strong><p>{t("importGuideStep1Body")}</p></li><li><strong>{t("importGuideStep2Title")}</strong><p>{t("importGuideStep2Body")}</p></li><li><strong>{t("importGuideStep3Title")}</strong><p>{t("importGuideStep3Body")}</p></li><li><strong>{t("importGuideStep4Title")}</strong><p>{t("importGuideStep4Body")}</p></li></ol><p className="knowledge-import-guide-note">{t("importGuideAvailability")}</p><footer><a href="https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data" target="_blank" rel="noopener noreferrer">{t("importGuideOfficial")}</a><button className="primary" onClick={() => { setShowImportGuide(false); window.setTimeout(() => importFileRef.current?.click(), 0); }}>{t("importDataFile")}</button></footer></section></div>, document.body) : null}</>;
}
