import type { ProjectAnalysisTarget } from "./project-analysis-csv";
import type { ProjectAnalysisResponse } from "./project-analysis-worker";

export async function projectAnalysisInBackground({ runId, sourceConversationIds }: ProjectAnalysisTarget): Promise<string | undefined> {
  const target = { runId, sourceConversationIds };
  const fallback = async () => (await import("./project-analysis-csv")).projectAnalysisCsv(target);
  if (typeof Worker === "undefined") return fallback();
  let worker: Worker;
  try { worker = new Worker(new URL("./project-analysis-worker.ts", import.meta.url), { type: "module" }); }
  catch { return fallback(); }
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<ProjectAnalysisResponse>) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.csv);
    };
    worker.onerror = () => { worker.terminate(); void fallback().then(resolve, reject); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error("Could not read the generation record / 无法读取生成记录")); };
    try { worker.postMessage(target); }
    catch (error) { worker.terminate(); reject(error); }
  });
}
