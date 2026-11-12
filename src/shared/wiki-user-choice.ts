/** A choice is a speech act, not any occurrence of a word such as 不用/使用.
 * Feasibility questions stay user intentions unless a separate directive chooses. */
export function wikiUserChooses(quote: string): boolean {
  // What the user quotes is not what the user says: a friend's review pasted as "> The app should support multiple
  // currencies" read as the user's own "should".
  const text = quote.split("\n").filter(line => !/^\s*>/u.test(line)).join("\n").replace(/"[^"\n]{20,}"|“[^”\n]{20,}”/gu, "").replace(/我(?:们)?想(?:知道|了解|问问?|确认|请教|看看)/gu, "");
  const explicit = /我(?:们)?(?:要|想|打算|决定|准备|希望|会|选)|(?:就|还是|先|只|统一)(?:用|做|按|保留|放|叫)|(?:请|帮我|给我)(?:直接)?(?:做|用|改|加|去掉|删除|保留)|就(?:这个|这样|它了)|\b(?:I|we) (?:want|need|decided|will)\b|\blet's\b|^[^\p{L}\p{N}]*(?:decided|confirmed|decision|final|settled|agreed)\s*[:：—–-]|\bchange of plan\b|\b(?:I|we)(?:'ll| will|'m| am|'re| are)? (?:go(?:ing)? with|chose|picked|settled on)\b/iu;
  const choice = /(?:喜欢|选|要|用)(?:这|那)(?:种|个|版|套|款)|不要|别(?=再|让|给|做|用|把|将|放|加|开|删|改|动|管|显示|生成|实现|重写|自动)|不用(?!的)|不做|不需要|不能|不可以|不允许|应该|应当|必须|需要|改成|改为|换成|保留|去掉|删掉|加上|加个|定为|就叫|采用|使用|\b(?:must|should|use|keep|drop|do not|don't|never|instead|only|exclude|remove|forget|switch to|stick with|no longer|is fixed at|is set to)\b|^[^\p{L}\p{N}]*no\s+\w/iu;
  // Saying a point is not decided is no choice: "I can't decide … let's leave it open for now".
  const undecided = /\bcan'?t decide\b|\bcannot decide\b|\bleave (?:it|this|them) open\b|\bundecided\b|还没想好|拿不定|先不定/iu;
  // A hedged line is a thought, not a decision: "考虑将侧重点放在……" and "maybe we could use Stripe" were marked 〔已定〕.
  // 可以 alone ("可以，就这样") and 不可以 (a refusal) still choose; a line that also says 决定/decided does too.
  const hedged = /考虑|也许|或许|可能|大概|不妨|倾向|建议|试试|试一下|要不要|或者|暂定|初步|设想|想法是|(?<![不也])可以(?![了吗啊呀吧，,。！!？?\s]|$)|也可以|\b(?:maybe|perhaps|might|may be|could|consider(?:ing)?|thinking (?:about|of)|suggest(?:ion)?|tentative(?:ly)?|possibly|probably|lean(?:ing)? (?:to|towards?)|how about|what if|ideally)\b/iu;
  const firm = /决定|确定|定了|拍板|就这么定|\b(?:decided|confirmed|settled|final)\b/iu;
  return text.split(/[。！？!?\n]|\.(?=\s)/u).some(sentence => {
    if (undecided.test(sentence)) return false;
    if (hedged.test(sentence) && !firm.test(sentence)) return false;
    // "是不是……应该侧重点放到……？这个方向竞争怎么样" asks; its 应该 chose nothing and was marked 〔已定〕. A line asking
    // outright asks, whatever it names ("首页应该只保留一个按钮吗").
    if (/是不是|会不会|对不对|行不行|好不好|[吗呢么]\s*$/u.test(sentence)) return false;
    if (explicit.test(sentence)) return true;
    if (/要不要|可不可以|能不能|是否|可以[^。！？]{0,60}吗|你(?:感觉|觉得|认为)|怎么样|如何|\b(?:can|could|should|would) (?:I|we)\b|\bwhat do you think\b/iu.test(sentence)) return false;
    return choice.test(sentence) || /(?:我的|我们的)(?:项目|产品)[^。！？]{0,12}(?:功能(?:就是|是|为)|定位(?:是|为))/u.test(sentence);
  });
}
