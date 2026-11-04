import type {FocusEvidence,WikiRevisionReceipt} from "../../shared/focus-session";

export function WikiRevisionSummary({receipt,evidence=[],zh}:{receipt?:WikiRevisionReceipt;evidence?:FocusEvidence[];zh:boolean}){
 if(!receipt)return null;
 return <div className="wiki-revision-summary"><p>{zh?`已处理 ${receipt.draftUnits} 个正文片段、${receipt.sourceUnits} 个来源片段 · ${receipt.batches} 批完成${receipt.cachedBatches?`，复用 ${receipt.cachedBatches} 批缓存`:""}`:`Processed ${receipt.draftUnits} draft units and ${receipt.sourceUnits} source units · ${receipt.batches} batches completed${receipt.cachedBatches?`, ${receipt.cachedBatches} reused`:""}`}</p>
 {receipt.keptDraftUnits?<p role="status">{zh?`部分完成：${receipt.keptDraftUnits} 个正文片段单独也超过一次调整的输入上限，已按原文保留，未做调整。`:`Partly revised: ${receipt.keptDraftUnits} draft units each exceed one revision request and were kept exactly as saved.`}</p>:null}
 {receipt.references.length?<details><summary>{zh?`保留在来源中的材料 ${receipt.references.length} 项`:`${receipt.references.length} materials retained in sources`}</summary><p>{zh?"这些材料未写入本次正文，原始来源保留。采用前请核对 AI 给出的归属理由。":"These materials were left in original sources. Review the AI's scope reasons before applying."}</p><ul>{receipt.references.map((item,index)=><li key={index}><strong>{evidence.find(ref=>item.evidenceIds.includes(ref.id))?.title??(zh?"原始讨论":"Original discussion")}</strong><blockquote>{item.excerpt}</blockquote><p>{item.reason}</p></li>)}</ul></details>:null}</div>;
}
