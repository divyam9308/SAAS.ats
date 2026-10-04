const key = stage => stage.id || stage.key || stage.name
const matches = (stage, value) => [key(stage), stage.name || stage.label || stage.id].includes(value)

// An explicit graph, including an empty graph, is authoritative. Older
// configurations without a graph retain the server's sequential fallback.
export function pipelineStageChoices(pipeline, currentValue) {
  const stages = pipeline?.stages || pipeline?.steps || []
  const current = stages.find(stage => matches(stage, currentValue))
  if (!current) return []
  return stages.filter((target, index) => {
    if (target === current) return false
    if (Array.isArray(pipeline.transitions) && !pipeline.transitions.some(edge => matches(current, edge.from) && matches(target, edge.to))) return false
    if (current.allowedTransitions?.length) return current.allowedTransitions.some(value => matches(target, value))
    return Array.isArray(pipeline.transitions) || index === stages.indexOf(current) + 1
  })
}
