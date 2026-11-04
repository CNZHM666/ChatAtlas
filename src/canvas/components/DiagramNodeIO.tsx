export function DiagramNodeIO({ node, zh }: { node: { inputs?: string[]; outputs?: string[] }; zh: boolean }) {
  if (!node.inputs?.length && !node.outputs?.length) return null;
  return <small className="route-card-io">
    {node.inputs?.length ? <span><b>{zh ? "输入" : "In"}</b><span>{node.inputs.join(" · ")}</span></span> : null}
    {node.outputs?.length ? <span><b>{zh ? "输出" : "Out"}</b><span>{node.outputs.join(" · ")}</span></span> : null}
  </small>;
}
