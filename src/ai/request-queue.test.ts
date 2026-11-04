import { afterEach, expect, it, vi } from "vitest";
import { ProviderQueue, providerQueue } from "./request-queue";

afterEach(() => vi.useRealTimers());
it("shares a two-request limit across chat and embedding paths of one service", async () => {
  const url = `https://${crypto.randomUUID()}.invalid`;
  const queue = providerQueue(`${url}/chat/completions`);
  expect(providerQueue(`${url}/embeddings`)).toBe(queue);
  const first = await queue.acquire(), second = await queue.acquire();
  let started = false;
  const pending = queue.acquire().then(release => { started = true; return release; });
  await Promise.resolve(); expect(started).toBe(false);
  first(); const third = await pending; expect(started).toBe(true);
  first(); second(); third();
});
it("starts questions before queued background indexing and never starts cancelled work", async () => {
  const queue = new ProviderQueue(), order: string[] = [];
  const first = await queue.acquire(), second = await queue.acquire();
  const controller = new AbortController();
  const cancelled = expect(queue.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  const background = queue.acquire(undefined, 0).then(release => { order.push("index"); return release; });
  const question = queue.acquire(undefined, 2).then(release => { order.push("question"); return release; });
  controller.abort(); await cancelled;
  first(); const answerRelease = await question;
  expect(order).toEqual(["question"]);
  second(); const backgroundRelease = await background;
  answerRelease(); backgroundRelease(); expect(order).toEqual(["question", "index"]);
});
it("pauses after rate limiting and temporarily resumes with one request", async () => {
  vi.useFakeTimers(); const queue = new ProviderQueue();
  queue.rateLimited(2000);
  const order: number[] = [];
  const first = queue.acquire().then(release => { order.push(1); return release; });
  const second = queue.acquire().then(release => { order.push(2); return release; });
  await vi.advanceTimersByTimeAsync(1999); expect(order).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(order).toEqual([1]);
  (await first)(); (await second)(); expect(order).toEqual([1, 2]);
});

it("ramps up one request per three successes and never exceeds six",async()=>{
 const queue=new ProviderQueue(),held:Array<()=>void>=[];let started=0;
 const take=()=>void queue.acquire().then(release=>{started++;held.push(release);});
 for(let i=0;i<8;i++)take();
 await new Promise(resolve=>setTimeout(resolve,0));expect(started).toBe(2);
 for(let i=0;i<3;i++)queue.succeeded();await new Promise(resolve=>setTimeout(resolve,0));expect(started).toBe(3);
 for(let i=0;i<30;i++)queue.succeeded();await new Promise(resolve=>setTimeout(resolve,0));expect(started).toBe(6);
 held.forEach(release=>release());
});
it("grows after successful requests and recovers after rate-limit cooldown",async()=>{
 vi.useFakeTimers();const queue=new ProviderQueue();for(let i=0;i<6;i++)queue.succeeded();
 const releases=await Promise.all([queue.acquire(),queue.acquire(),queue.acquire()]);releases.forEach(release=>release());
 queue.rateLimited(1000);let started=0;
 const first=queue.acquire().then(release=>{started++;return release;});const second=queue.acquire().then(release=>{started++;return release;});
 await vi.advanceTimersByTimeAsync(1000);expect(started).toBe(1);(await first)();(await second)();
 await vi.advanceTimersByTimeAsync(60_000);
 const recovered=await Promise.all([queue.acquire(),queue.acquire()]);recovered.forEach(release=>release());
});

it("lets a high-limit host ramp to ten parallel requests while an unknown gateway stops at six",async()=>{
 const started=async(url:string)=>{
  const queue=providerQueue(url);for(let i=0;i<30;i++)queue.succeeded();
  let running=0;for(let i=0;i<12;i++)void queue.acquire().then(()=>{running++;});
  await new Promise(resolve=>setTimeout(resolve,0));return running;
 };
 expect(await started(`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions?${crypto.randomUUID()}`)).toBe(10);
 expect(await started(`https://gateway-${crypto.randomUUID()}.example/v1/chat/completions`)).toBe(6);
});
