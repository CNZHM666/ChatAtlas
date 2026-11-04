import {historyRequest} from "./history-request";
import {subjectQueryVariants} from "./subject-query";
/** Small explicit vocabulary bridge, not an embedding model or inferred historical fact. */
export function memoryQueryVariants(input:string) {
 if(/["“]/u.test(input))return [input];
 const clean=historyRequest(input).query.replace(/我记得|我们|讨论过一个|讨论过|说过某个|曾经提过|在哪条消息里|在哪条消息|在哪里|哪条消息里|帮我找出来|找出来|几个月前|那段|的方案|的问题|某个功能|某个方案/gu," ").replace(/\s+/gu," ").trim();
 // Drop conversational scaffolding only; entity names, identifiers and quoted searches survive.
 const topic=clean.replace(/后来为什么改了|后来为什么|为什么(?:会|要|决定)?|为何|当时(?:怎么|为什么)|最后(?:决定|选择)?|决定|暂时不做|到底|后来|改成什么|改了什么|怎么改的|如何修改|是什么|什么时候|还记得|曾经|那个|这个|的原因|原因是什么|帮忙|找一下/gu," ").replace(/\b(?:why|did|we|our|was|were|what|the|that|approach|discussed|previously|postpone|decide|to)\b/giu," ").replace(/\s+/gu," ").trim();
 const variants=[...new Set([clean,topic].filter(Boolean).flatMap(value=>subjectQueryVariants(value)))].slice(0,8);
 return variants.filter(Boolean);
}
