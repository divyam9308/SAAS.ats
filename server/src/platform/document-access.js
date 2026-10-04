'use strict'

/**
 * Check document visibility after the caller has checked access to its parent.
 * Public and team documents follow that parent scope; private/restricted
 * documents additionally require ownership or document administration.
 */
function canViewDocument(doc, actor, hasPermission) {
  if (!doc || !actor) return false
  if (doc.visibility === 'public' || doc.visibility === 'team') return true
  return doc.ownerId === actor.id || Boolean(hasPermission?.(actor, 'documents:administer'))
}

module.exports = { canViewDocument }
