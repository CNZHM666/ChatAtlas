import type { AtlasMessage } from "../shared/messages";
import { brandLogos } from "../shared/brand-assets";
import { webCaptureSite, type WebCapturePlatform } from "../shared/web-capture";
import { ATLAS_TRIGGER_STYLE } from "./atlas-trigger-style";
import { pageTheme } from "./page-theme";
import { extensionAlive } from "./extension-alive";
import { EXCLUDED_TOOLBAR_ANCESTORS, EXCLUDED_TOOLBAR_CONTROLS, isInRightCluster, isVerticallyAligned, toolbarRowSibling, topRightMinLeft } from "./top-right-anchor";

const entries = new WeakSet<HTMLElement>();
const nativeAction = 'button, [role="button"], .ds-icon-button, [class*="icon-button"], [tabindex="0"][aria-label]';

interface PlatformProfile {
  /** Extra platform-specific top-right anchor selectors checked alongside Share/header controls. */
  selectors: string[];
  /** Preferred button corner radius when the host anchor does not expose an explicit rounded radius. */
  defaultRadius: string;
  /** Minimum horizontal fraction of the viewport for a valid top-right toolbar anchor. */
  minLeftRatio: number;
  /** Maximum top offset (px) for a valid top-right toolbar anchor. */
  maxBottom: number;
  /** Gap (px) between the trigger and the anchor when using aligned-edge fallback. */
  edgeGap: number;
}

const DEFAULT_PROFILE: PlatformProfile = {
  selectors: [],
  defaultRadius: "9px",
  minLeftRatio: 0.62,
  maxBottom: 100,
  edgeGap: 8,
};

const PLATFORM_PROFILES: Record<WebCapturePlatform, PlatformProfile> = {
  claude: {
    selectors: ['button[data-testid*="share" i]', 'header button[aria-label]', '[data-testid="chat-header"] button'],
    defaultRadius: "8px",
    minLeftRatio: 0.62,
    maxBottom: 92,
    edgeGap: 6,
  },
  gemini: {
    selectors: [
      'button[data-test-id*="share" i]',
      'a[aria-label*="Google" i]',
      'button[aria-label*="Google" i]',
      '.gb_B',
      'header button',
      'top-bar-actions button',
    ],
    defaultRadius: "999px",
    minLeftRatio: 0.62,
    maxBottom: 96,
    edgeGap: 8,
  },
  deepseek: {
    selectors: [".ds-icon-button", '[class*="header"] button', '[class*="top"] [role="button"]'],
    defaultRadius: "10px",
    minLeftRatio: 0.62,
    maxBottom: 96,
    edgeGap: 8,
  },
  doubao: {
    selectors: [
      '[data-testid*="share" i]',
      '[data-testid*="header"] button',
      '[class*="header"] button',
      '[class*="Header"] button',
      '[class*="top-bar"] [role="button"]',
    ],
    defaultRadius: "999px",
    minLeftRatio: 0.62,
    maxBottom: 96,
    edgeGap: 8,
  },
  kimi: {
    selectors: [
      '[class*="header"] button',
      '[class*="Header"] button',
      '[class*="chat-header"] [role="button"]',
      '[class*="action"] button',
    ],
    defaultRadius: "10px",
    minLeftRatio: 0.62,
    maxBottom: 96,
    edgeGap: 8,
  },
  qwen: {
    selectors: [
      '[data-testid*="share" i]',
      '[class*="header"] button',
      '[class*="Header"] button',
      '[class*="header"] [role="button"]',
    ],
    defaultRadius: "10px",
    minLeftRatio: 0.62,
    maxBottom: 96,
    edgeGap: 8,
  },
};

interface NativeAnchor {
  /** Element to insert before when placing inside a horizontal flex/grid toolbar. */
  sibling?: HTMLElement;
  /** Visual bounding rect of the native icon button for size and center alignment. */
  rect: DOMRect;
  /** Computed border-radius of the native icon button. */
  radius?: string;
}

function toolbarAction(platform?: WebCapturePlatform): NativeAnchor | undefined {
  const profile = platform ? PLATFORM_PROFILES[platform] : DEFAULT_PROFILE;
  const minLeft = topRightMinLeft(profile.minLeftRatio);
  const selector = profile.selectors.length ? `${nativeAction}, ${profile.selectors.join(", ")}` : nativeAction;
  const platformSelector = profile.selectors.join(", ");
  const seen = new Set<HTMLElement>();
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap(action => {
    if (seen.has(action)) return [];
    seen.add(action);
    if (action.matches(EXCLUDED_TOOLBAR_CONTROLS) || action.closest(EXCLUDED_TOOLBAR_ANCESTORS) || !action.parentElement) return [];
    const share = action.matches('[data-testid*="share" i], [data-test-id*="share" i], [data-action="share"]') || [
      action.getAttribute("aria-label"), action.getAttribute("title"), action.getAttribute("data-tooltip"), action.textContent,
    ].some(label => /^(?:分享(?:聊天|对话)?|share(?: chat| conversation)?)$/iu.test(label?.trim() ?? ""));
    const dsIcon = action.matches(".ds-icon-button");
    const platformMatch = Boolean(platformSelector && action.matches(platformSelector));
    const inHeader = Boolean(action.closest('header, [role="banner"], [role="toolbar"], [data-testid$="-header"]'));
    if (!share && !dsIcon && !platformMatch && !inHeader) return [];
    const rect = action.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16 || rect.top < 0 || rect.bottom > profile.maxBottom || rect.left < minLeft) return [];
    const style = getComputedStyle(action);
    if (style.visibility === "hidden" || style.opacity === "0") return [];
    const sibling = toolbarRowSibling(action);
    return [{ action, sibling, rect, share, dsIcon, platformMatch, radius: style.borderRadius }];
  });
  if (!candidates.length) return undefined;
  const maxRight = Math.max(...candidates.map(item => item.rect.right));
  const rightCluster = candidates.filter(item => item.share || isInRightCluster(item.rect, maxRight));
  const pool = rightCluster.length ? rightCluster : candidates;
  const best = pool.sort((a, b) =>
    Number(b.share) - Number(a.share)
    || Number(Boolean(b.sibling)) - Number(Boolean(a.sibling))
    || Number(b.dsIcon) - Number(a.dsIcon)
    || Number(b.platformMatch) - Number(a.platformMatch)
    || a.rect.top - b.rect.top
    || a.rect.left - b.rect.left
  )[0];
  return best ? { sibling: best.sibling, rect: best.rect, radius: best.radius } : undefined;
}

/** Platform-adapted native-panel entry beside each site's top-right actions, with a sleek floating fallback. */
export function webChatEntry(explicitPlatform?: WebCapturePlatform) {
  const id = "atlas-web-chat-entry", styleId = "atlas-navigator-trigger-style";
  const zh = /^zh\b/iu.test(navigator.language);
  const label = zh ? "ChatAtlas 知识助手" : "ChatAtlas knowledge companion";
  const resolvePlatform = () => explicitPlatform ?? webCaptureSite(location.href)?.id;
  // This script is built on its own, with the logo inlined as a data URL: only a file path is an extension resource.
  const logo = () => {
    const source = brandLogos[pageTheme()];
    return source.startsWith("data:") ? source : chrome.runtime.getURL(source.replace(/^\//u, ""));
  };
  let status: HTMLElement | undefined, dismiss: ReturnType<typeof setTimeout> | undefined, opening = false;
  const clearStatus = () => { clearTimeout(dismiss); status?.remove(); status = undefined; };
  const open = async () => {
    if (opening) return;
    opening = true;
    clearStatus();
    try {
      if (extensionAlive()) {
        const result = await chrome.runtime.sendMessage({ type: "ATLAS_OPEN_SIDEPANEL" } satisfies AtlasMessage).catch(() => undefined);
        if (result?.ok) return;
        const fallback = await chrome.runtime.sendMessage({ type: "ATLAS_OPEN" } satisfies AtlasMessage);
        if (fallback?.ok) return;
      }
    } catch { /* The previous extension context can survive in an open tab. */ }
    finally { opening = false; }
    if (!document.getElementById(id)) return;
    clearStatus();
    status = document.createElement("div"); status.className = "atlas-trigger-status"; status.setAttribute("role", "status");
    status.textContent = extensionAlive() ? (zh ? "暂时无法打开 ChatAtlas，请重试。" : "Could not open ChatAtlas. Try again.")
      : (zh ? "扩展已重新加载。请刷新此页面后打开 ChatAtlas。" : "ChatAtlas was reloaded. Refresh this page to reconnect.");
    document.body.append(status);
    dismiss = setTimeout(clearStatus, 6000);
  };
  const ensure = () => {
    if (!document.body || !extensionAlive()) return;
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style"); style.id = styleId;
      (document.head ?? document.documentElement).append(style);
    }
    if (style.textContent !== ATLAS_TRIGGER_STYLE) style.textContent = ATLAS_TRIGGER_STYLE;
    const placed = Array.from(document.querySelectorAll<HTMLButtonElement>(`#${id}`));
    let button = placed.find(node => entries.has(node) && node.querySelector(".atlas-trigger-mark img"));
    for (const node of placed) if (node !== button) node.remove();
    if (!button) {
      const created = document.createElement("button"); created.id = id; created.type = "button";
      created.setAttribute("aria-label", label); created.title = `${label} · Ctrl+Shift+Y`;
      const mark = document.createElement("span"); mark.className = "atlas-trigger-mark"; mark.setAttribute("aria-hidden", "true");
      const image = document.createElement("img"); image.alt = ""; image.width = 23; image.height = 23; image.draggable = false; mark.append(image);
      const name = document.createElement("span"); name.className = "atlas-trigger-label"; name.textContent = "ChatAtlas";
      created.append(mark, name);
      created.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); void open(); }, { capture: true });
      entries.add(created); button = created;
    }
    const theme = pageTheme();
    const platform = resolvePlatform();
    const profile = platform ? PLATFORM_PROFILES[platform] : DEFAULT_PROFILE;
    if (platform) button.dataset.atlasPlatform = platform;
    else delete button.dataset.atlasPlatform;
    button.dataset.atlasTheme = theme;
    const image = button.querySelector("img")!, source = logo();
    if (image.getAttribute("src") !== source) image.src = source;
    const anchor = toolbarAction(platform);
    const inToolbar = Boolean(anchor?.sibling);
    const variant = inToolbar ? "toolbar" : "edge";
    const alignedEdge = !inToolbar && Boolean(anchor);
    const className = `atlas-navigator-trigger atlas-navigator-trigger--${variant}${alignedEdge ? " is-anchor-aligned" : ""}`;
    if (button.className !== className) button.className = className;
    if (anchor) {
      const size = Math.round(Math.min(36, Math.max(28, anchor.rect.height)));
      const icon = Math.round(Math.min(22, Math.max(18, size * 0.64)));
      button.style.setProperty("--atlas-trigger-size", `${size}px`);
      button.style.setProperty("--atlas-trigger-icon", `${icon}px`);
      const radius = anchor.radius && anchor.radius !== "0px" ? anchor.radius : profile.defaultRadius;
      button.style.setProperty("--atlas-trigger-radius", radius);
      if (inToolbar && anchor.sibling) {
        button.style.removeProperty("top");
        button.style.removeProperty("right");
        if (anchor.sibling.previousElementSibling !== button) anchor.sibling.before(button);
        if (!isVerticallyAligned(button.getBoundingClientRect(), anchor.rect)) {
          button.className = "atlas-navigator-trigger atlas-navigator-trigger--edge is-anchor-aligned";
          const top = Math.max(4, Math.round(anchor.rect.top + (anchor.rect.height - size) / 2));
          const right = Math.max(8, Math.round(window.innerWidth - anchor.rect.left + profile.edgeGap));
          button.style.top = `${top}px`;
          button.style.right = `${right}px`;
          if (button.parentElement !== document.body) document.body.append(button);
        }
      } else {
        const top = Math.max(4, Math.round(anchor.rect.top + (anchor.rect.height - size) / 2));
        const right = Math.max(8, Math.round(window.innerWidth - anchor.rect.left + profile.edgeGap));
        button.style.top = `${top}px`;
        button.style.right = `${right}px`;
        if (button.parentElement !== document.body) document.body.append(button);
      }
    } else {
      button.style.removeProperty("--atlas-trigger-size");
      button.style.removeProperty("--atlas-trigger-icon");
      button.style.removeProperty("--atlas-trigger-radius");
      button.style.removeProperty("top");
      button.style.removeProperty("right");
      if (button.parentElement !== document.body) document.body.append(button);
    }
  };
  return { ensure, remove: () => { clearStatus(); document.getElementById(id)?.remove(); } };
}
