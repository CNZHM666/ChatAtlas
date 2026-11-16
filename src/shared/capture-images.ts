import type { ConversationCapture } from "./types";
import { createContentHash, previewMessage } from "../content/message-identity";
import { imageLinks, originalImageReference, rasterDataUrl, type ImportedImageResource } from "./conversation-images";

/** Resources stay out of searchable prose and model input. Canonical IDs are content-addressed. */
export async function materializeCaptureImages(capture: ConversationCapture, resources: ImportedImageResource[] = [], retainedSources: ReadonlyMap<string, string> = new Map()): Promise<ConversationCapture> {
  const aliases = new Map<string, string | undefined>();
  for (const resource of resources) for (const reference of resource.references) {
    const alias = originalImageReference(reference);
    if (!aliases.has(alias)) aliases.set(alias, resource.dataUrl);
    else if (aliases.get(alias) !== resource.dataUrl) aliases.set(alias, undefined);
  }
  const assets = new Map((capture.imageAssets ?? []).map(asset => [asset.id, asset]));
  const ids = new Map<string, string>();
  const rewrite = async (original: string, sources: Map<string, string>) => {
    let content = original;
    for (const link of imageLinks(original).reverse()) {
      const reference = originalImageReference(link.source);
      const dataUrl = rasterDataUrl(reference) ? reference : aliases.get(reference);
      let id = dataUrl && rasterDataUrl(dataUrl) ? ids.get(dataUrl) : retainedSources.get(reference);
      if (dataUrl && rasterDataUrl(dataUrl)) {
        if (!id) { id = `sha256-${await createContentHash(dataUrl)}`; ids.set(dataUrl, id); }
        assets.set(id, { id, dataUrl });
      }
      if (!id) continue;
      if (!rasterDataUrl(reference)) sources.set(reference, id);
      content = content.slice(0, link.start) + `atlas-image:${id}` + content.slice(link.end);
    }
    return content;
  };
  const messages = [];
  for (const message of capture.messages) {
    const sources = new Map(message.imageSources?.map(source => [source.reference, source.assetId]));
    const content = await rewrite(message.content, sources);
    const uiParts = message.uiParts ? await Promise.all(message.uiParts.map(async part => part.fallbackText ? { ...part, fallbackText: await rewrite(part.fallbackText, sources) } : part)) : undefined;
    messages.push({ ...message, ...(sources.size ? { imageSources: [...sources].map(([reference, assetId]) => ({ reference, assetId })) } : {}), ...(uiParts ? { uiParts } : {}), ...(content === message.content ? {} : { content, preview: previewMessage(content), contentHash: await createContentHash(`${message.role}\n${content}`) }) });
  }
  return { ...capture, messages, ...(assets.size ? { imageAssets: [...assets.values()] } : {}) };
}
