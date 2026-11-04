import type {WikiPlanningProgress} from "../../shared/focus-progress";

export function WikiPlanningStatus({progress,zh,paused=false}:{progress?:WikiPlanningProgress;zh:boolean;paused?:boolean}) {
 if(!progress)return null;
 return <div className="generation-directory-status">
  <p>{zh?`目录批次已完成 ${progress.completedWindows}/${progress.totalWindows}，复用 ${progress.reusedWindows} 批。`:`Directory batches: ${progress.completedWindows}/${progress.totalWindows} complete, ${progress.reusedWindows} reused.`}</p>
  {progress.merging?<p>{zh?`正在合并章节：第 ${progress.merging.round} 轮，当前 ${progress.merging.chapters} 章，目标不超过 ${progress.merging.target} 章。`:`Merging chapters: round ${progress.merging.round}, ${progress.merging.chapters} chapters now, target ${progress.merging.target} or fewer.`}</p>:null}
  {progress.pendingAssignments>0?<p>{zh?`${paused?"材料归属核对已暂停":"正在局部核对材料归属"}：已确认 ${progress.confirmedAssignments} 项，剩余 ${progress.pendingAssignments} 项。`:`${paused?"Material assignment review paused":"Checking material assignments"}: ${progress.confirmedAssignments} confirmed, ${progress.pendingAssignments} remaining.`}</p>:null}
  {progress.quarantinedReferences>0?<p>{zh?`已隔离 ${progress.quarantinedReferences} 处无效编号引用，原始材料仍保留。`:`Isolated ${progress.quarantinedReferences} invalid references; original materials are retained.`}</p>:null}
 </div>;
}
