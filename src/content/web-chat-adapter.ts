import { webConversation, type WebCapturePlatform, type WebPageInspection } from "../shared/web-capture";
import type { CaptureAdapter, ParsedChatMessage } from "./capture-adapter";
import { domMessageText } from "./dom-message-text";
import {createContentHash,previewMessage} from "./message-identity";
import type {NativeMessageIdentity} from "../shared/native-discussion";
import {findQuestionBlock,sameQuestionText} from "./question-text";

// Site contracts are intentionally narrow. Unknown layouts yield no capture,
// rather than guessing roles from alternating paragraphs or reading the editor.
const SELECTORS: Record<WebCapturePlatform, { user: string; assistant: string; content?: string }> = {
  claude: { user: '[data-testid="user-message"],.font-user-message', assistant: '.font-claude-response,[data-testid="assistant-message"],[data-is-streaming]' },
  gemini: { user: 'user-query,.query-text', assistant: 'model-response', content: 'message-content,.markdown-main-panel,.response-content' },
  deepseek: { user: '[data-message-author-role="user"],[data-testid="user-message"],.user-message,.fbb737a4', assistant: '[data-message-author-role="assistant"],[data-testid="assistant-message"],.ds-message--assistant,.ds-markdown' },
  doubao: { user: '[data-testid="send_message"],[class*="bg-g-send-msg-bubble"]', assistant: '[data-testid="receive_message"],[class*="bg-g-receive-msg-bubble"],.flow-markdown-body,.md-box-root', content: '[data-testid="message_text_content"],.flow-markdown-body,.md-box-root' },
  kimi: { user: '.chat-content-item-user,.segment-user', assistant: '.chat-content-item-assistant,.segment-assistant' },
  qwen: { user: '[data-chat-question-wrap],.qwen-chat-message-user,.chat-user-message-container-wrapper', assistant: '[data-chat-answers-wrap],.qwen-chat-message-assistant,.qwen-chat-message-bot,.chat-assistant-message-container-wrapper', content: '#qk-markdown-react,.markdown-body,.response-message-content' },
};
const EXCLUDED = 'aside,nav,form,textarea,[contenteditable="true"],[hidden],[aria-hidden="true"],[data-testid*="thinking"],.ds-think-content,.toolcall-container,[data-testid="flow_chat_sidebar"]';
function shown(element: Element) {
  if (element.closest(EXCLUDED)) return false;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent); if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
export class WebChatAdapter implements CaptureAdapter {
  constructor(readonly platform: WebCapturePlatform, private address = () => window.location.href) {}
  detectConversation() {
    const conversation = webConversation(this.address());
    if (!conversation || conversation.site.id !== this.platform) return null;
    const title = document.title.replace(/\s*[-–—|]\s*(?:Claude|Gemini|Google Gemini|DeepSeek|豆包|Doubao|Kimi|Kimi AI|通义千问|千问|Qwen)\s*$/iu, "").trim();
    return { id: conversation.id, url: conversation.url, title: title && !/^(Claude|Gemini|Google Gemini|DeepSeek|豆包|Doubao|Kimi|Kimi AI|通义千问|千问|Qwen)$/iu.test(title) ? title : "Untitled conversation" };
  }
  inspect(): WebPageInspection {
    const conversation = this.detectConversation();
    if (!conversation) return {state:"unsupported",messageCount:0};
    const messageCount = this.parseMessages().length;
    return {conversationId:conversation.id,messageCount,state:this.isStreaming()?"streaming":messageCount?"ready":"empty"};
  }
  composer(): HTMLTextAreaElement | HTMLElement | null {
    const selectors:Record<WebCapturePlatform,string>={
      claude:'[contenteditable="true"].ProseMirror,[contenteditable="true"][role="textbox"]',
      gemini:'rich-textarea [contenteditable="true"],[contenteditable="true"][role="textbox"]',
      deepseek:'textarea',doubao:'textarea[data-testid="chat_input_input"],[data-testid="chat_input"] textarea,.chat-input textarea,.chat-input [contenteditable="true"],.chat-editor textarea,.chat-editor [contenteditable="true"]',
      kimi:'[contenteditable="true"][role="textbox"]',qwen:'[role="textbox"][contenteditable="true"],textarea#chat-input',
    };
    const scope=document.querySelector('main')??document.body;
    return [...scope.querySelectorAll<HTMLElement>(selectors[this.platform])].find(node=>{
      if(node.closest('aside,nav,[role="dialog"],[role="search"],[role="searchbox"]'))return false;
      for(let parent:Element|null=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.matches('[hidden],[aria-hidden="true"]')||style.display==="none"||style.visibility==="hidden")return false;}
      return !node.matches('[disabled],[readonly],[aria-disabled="true"]');
    })??null;
  }
  scrollContainer(element:HTMLElement):HTMLElement|Window {
    for(let parent=element.parentElement;parent;parent=parent.parentElement)if(/auto|scroll/u.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight)return parent;
    return window;
  }
  stickyHeaderBottom(){return 0;}
  followingAssistant(element:HTMLElement){const rows=this.parseMessages(),index=rows.findIndex(row=>row.element===element);return index>=0&&rows[index+1]?.role==="assistant"?rows[index+1].element:null;}
  private revealRevision=0;
  cancelLocate(){this.revealRevision++;}
  /** Long chats load earlier messages only when scrolled to the top. Scroll up in bounded steps until the question
   * appears, the history stops growing, the user scrolls or another request starts; restore the view on failure. */
  async revealMessage(identity:NativeMessageIdentity):Promise<HTMLElement|null> {
    const conversation=this.detectConversation()?.id,first=this.parseMessages()[0]?.element;
    if(!conversation||!first||identity.role!=="user")return null;
    const revision=++this.revealRevision,container=this.scrollContainer(first);
    const top=()=>container===window?window.scrollY:(container as HTMLElement).scrollTop;
    const size=()=>container===window?document.documentElement.scrollHeight:(container as HTMLElement).scrollHeight;
    const initial=top(),initialSize=size(),deadline=Date.now()+12_000;
    let interrupted=false,stalled=0;
    const stop=()=>{interrupted=true;};
    const events=["wheel","touchstart","keydown"] as const;
    events.forEach(event=>window.addEventListener(event,stop,{passive:true}));
    const live=()=>!interrupted&&this.revealRevision===revision&&this.detectConversation()?.id===conversation;
    try{
      while(live()&&Date.now()<deadline&&stalled<3){
        const before=size(),count=this.parseMessages().length;
        container.scrollTo({top:0,behavior:"instant" as ScrollBehavior});
        await new Promise(resolve=>setTimeout(resolve,700));
        if(!live())return null;
        const found=await this.locateMessage(identity);
        if(found)return found;
        stalled=size()===before&&this.parseMessages().length===count?stalled+1:0;
      }
      // Earlier history now sits above; keep the user's original messages in view.
      if(live())container.scrollTo({top:initial+size()-initialSize,behavior:"instant" as ScrollBehavior});
      return null;
    }finally{events.forEach(event=>window.removeEventListener(event,stop));}
  }
  async locateMessage(identity:NativeMessageIdentity):Promise<HTMLElement|null> {
    const id=this.detectConversation()?.id,rows=this.parseMessages().filter(row=>row.role===(identity.role??"user"));
    const native=identity.messageId?rows.filter(row=>row.stableId===identity.messageId):[];
    if(native.length===1)return native[0].element;
    const matched:HTMLElement[]=[];
    for(const row of rows)if(await createContentHash(`${row.role}\n${row.text}`)===identity.contentHash)matched.push(row.element);
    if(this.detectConversation()?.id!==id)return null;
    // A repeated identical question without a platform ID is ambiguous.
    if(matched.length===1)return matched[0];
    if(matched.length>1)return null;
    // A page renders the saved question differently (labels, Markdown): the same full text is the question.
    if(identity.text&&(identity.role??"user")==="user"){const same=rows.filter(row=>sameQuestionText(row.text,identity.text!,identity.textTruncated));if(same.length===1)return same[0].element;if(!rows.length)return findQuestionBlock(identity.text,identity.textTruncated);}
    if(identity.contentHash)return null;
    const previews=rows.filter(row=>previewMessage(row.text)===identity.preview);
    return previews.length===1?previews[0].element:null;
  }
  isStreaming() {
    const scope = document.querySelector("main") ?? document.body;
    const extra = this.platform === "kimi" ? ',.send-button-container.stop,svg[name="Stop"]' : '';
    return [...scope.querySelectorAll('[data-is-streaming="true"],[data-testid="stop-button"],[data-testid="stop-generation-button"],[data-testid="chat_input_stop_button"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止回答"],model-response[aria-busy="true"]'+extra)].some(shown);
  }
  parseMessages(): ParsedChatMessage[] {
    if (!this.detectConversation()) return [];
    const scope = document.querySelector("main") ?? document.body, selectors = SELECTORS[this.platform];
    const candidates = [...scope.querySelectorAll<HTMLElement>(`${selectors.user},${selectors.assistant}`)].filter(node => shown(node) && !(node.matches(selectors.assistant) && node.parentElement?.closest(selectors.user)));
    // Prefer one containing message over its nested Markdown, in original DOM order.
    const roots = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node) && other.matches(selectors.user) === node.matches(selectors.user)));
    const messages=roots.flatMap((element): ParsedChatMessage[] => {
      const role = element.matches(selectors.user) ? "user" : "assistant";
      if (role === "assistant" && element.querySelector(selectors.user)) return [];
      const body = role === "assistant" && selectors.content ? element.querySelector<HTMLElement>(selectors.content) ?? element : this.platform === "gemini" && role === "user" ? element.querySelector<HTMLElement>(".query-text") ?? element : element;
      const text = domMessageText(body); if (!text.trim()) return [];
      const holder = element.closest<HTMLElement>("[data-message-id],[data-message-uuid],[data-turn-id],[data-response-id]");
      const rawId = holder?.dataset.messageId ?? holder?.dataset.messageUuid ?? holder?.dataset.responseId ?? holder?.dataset.turnId;
      // Turn containers may own both roles; their role suffix must stay distinct.
      const sharedTurn = holder?.dataset.turnId || holder?.querySelector(selectors.user) && holder.querySelector(selectors.assistant);
      const stableId = rawId ? sharedTurn ? `${rawId}:${role}` : rawId : undefined;
      return [{ element, role, stableId, index: 0, text }];
    });
    const coalesced:ParsedChatMessage[]=[],known=new Map<string,ParsedChatMessage>();
    for(const message of messages){
      const key=message.stableId?`${message.role}:${message.stableId}`:undefined, previous=key?known.get(key):undefined;
      if(previous){if(previous.text!==message.text)previous.text+=`\n\n${message.text}`;}
      else{coalesced.push(message);if(key)known.set(key,message);}
    }
    return coalesced.map((message,index)=>({...message,index}));
  }
}
