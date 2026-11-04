/** A choice is a speech act, not any occurrence of a word such as 不用/使用.
 * Feasibility questions stay user intentions unless a separate directive chooses. */
export function wikiUserChooses(quote: string): boolean {
  const text = quote.replace(/我(?:们)?想(?:知道|了解|问问?|确认|请教|看看)/gu, "");
  const explicit = /我(?:们)?(?:要|想|打算|决定|准备|希望|会|选)|(?:就|还是|先|只|统一)(?:用|做|按|保留|放|叫)|(?:请|帮我|给我)(?:直接)?(?:做|用|改|加|去掉|删除|保留)|就(?:这个|这样|它了)|\b(?:I|we) (?:want|need|decided|will)\b|\blet's\b/iu;
  const choice = /(?:喜欢|选|要|用)(?:这|那)(?:种|个|版|套|款)|不要|别(?=再|让|给|做|用|把|将|放|加|开|删|改|动|管|显示|生成|实现|重写|自动)|不用(?!的)|不做|不需要|不能|应该|应当|必须|需要|改成|改为|换成|保留|去掉|删掉|加上|加个|定为|就叫|采用|使用|\b(?:must|should|use|keep|drop)\b/iu;
  return text.split(/[。！？!?\n]/u).some(sentence => {
    if (explicit.test(sentence)) return true;
    if (/可不可以|能不能|是否|可以[^。！？]{0,60}吗|你(?:感觉|觉得|认为)|怎么样|如何|\b(?:can|could|should|would) (?:I|we)\b|\bwhat do you think\b/iu.test(sentence)) return false;
    return choice.test(sentence) || /(?:我的|我们的)(?:项目|产品)[^。！？]{0,12}(?:功能(?:就是|是|为)|定位(?:是|为))/u.test(sentence);
  });
}
