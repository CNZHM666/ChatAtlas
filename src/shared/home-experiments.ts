import {homeEntryIntent} from "./home-entry-intent";

/** These actions remain internal experiments; the public home has no opt-in control. */
export function experimentalHomeGoal(goal:string):boolean {
  return homeEntryIntent(goal)==="summarize"||/^(?:请|帮我|请帮我|我想)?\s*(?:发现|推荐|探索|挖掘|discover\b|recommend\b).*(?:主题|topics?|共同项目|共同内容)/iu.test(goal.trim());
}
