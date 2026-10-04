// Keep display selection aligned with the server's scorecard resolution order.
export function interviewScorecard(config = {}, interview = {}, context = {}) {
  const cards = config.scorecards || []
  const round = config.interviewPlans?.find(plan => plan.id === (interview.interviewPlanId || interview.planId))?.rounds?.find(item => item.id === (interview.roundId || interview.round))
  const id = interview.scorecardId || round?.scorecardId || interview.jobScorecardId || context.job?.scorecardId || context.job?.interviewScorecardId || interview.roleScorecardId || context.role?.scorecardId || context.role?.interviewScorecardId
  if (id) return cards.find(card => card.id === id) || null
  const matches = (card, entity, value) => {
    const selector = card[entity] ?? card[`${entity}Ids`] ?? card[`for${entity[0].toUpperCase()}${entity.slice(1)}`]
    return (Array.isArray(selector) ? selector : selector == null ? [] : [selector]).includes(value)
  }
  return cards.find(card => matches(card, 'job', interview.jobId || context.job?.id)) || cards.find(card => matches(card, 'role', interview.roleId || context.job?.roleId || context.job?.jobRoleId || context.role?.id)) || cards.find(card => card.default) || cards[0] || null
}

export function scorecardRatings(card) {
  const min = Number(card?.ratingScale?.min ?? 1), max = Number(card?.ratingScale?.max ?? 5)
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min > 99) return []
  const labels = card?.ratingScale?.labels || []
  return Array.from({ length: max - min + 1 }, (_, index) => {
    const value = min + index
    const label = labels[Array.isArray(labels) ? index : value]
    return { value, label: label ? `${value} · ${label}` : String(value) }
  })
}

export function scorecardLabelList(scale = {}) {
  if (Array.isArray(scale.labels)) return scale.labels
  const min = Number(scale.min ?? 1), max = Number(scale.max ?? 5)
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min > 99) return []
  return Array.from({ length: max - min + 1 }, (_, index) => scale.labels?.[min + index] ?? '')
}

export function scorecardCriteria(card, interviewerId) {
  const specific = card?.interviewerCriteria?.[interviewerId]
    || (Array.isArray(card?.interviewerCriteria) ? card.interviewerCriteria.find(entry => entry?.interviewerId === interviewerId)?.criteria : null)
  const criteria = specific || card?.competencies || card?.criteria || card?.questions || []
  return Array.isArray(criteria) ? criteria : []
}
