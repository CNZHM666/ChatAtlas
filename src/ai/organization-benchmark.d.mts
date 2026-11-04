export interface BenchmarkSummary {
 runs:number;requests?:number;inputTokens?:number;outputTokens?:number;cachedInputTokens?:number;failures?:number;
 failuresByOrigin:Record<string,number>;originsMeasured:number;stages:Record<string,number>;firstReadableMs?:number;firstReadableMeasured:number;elapsedMs?:number;statuses:Record<string,number>;
}
export interface BenchmarkDifference {metric:string;before?:number;after?:number;delta?:number;percent?:number}
export function parseAnalysisCsv(text:string):Record<string,string>[];
export function summarizeAnalysisCsv(text:string):BenchmarkSummary;
export function compareBenchmarks(before:BenchmarkSummary,after:BenchmarkSummary):BenchmarkDifference[];
