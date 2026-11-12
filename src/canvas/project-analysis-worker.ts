import { projectAnalysisCsv, type ProjectAnalysisTarget } from "./project-analysis-csv";

export type ProjectAnalysisResponse = { csv?: string } | { error: string };

const worker = globalThis as unknown as {
  postMessage(response: ProjectAnalysisResponse): void;
  onmessage: ((event: MessageEvent<ProjectAnalysisTarget>) => void) | null;
};

worker.onmessage = ({ data }) => {
  void projectAnalysisCsv(data).then(
    csv => worker.postMessage({ csv }),
    (error: unknown) => worker.postMessage({ error: error instanceof Error ? error.message : String(error) }),
  );
};
