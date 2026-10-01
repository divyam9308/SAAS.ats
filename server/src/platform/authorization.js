function configPermissions(config, roleName) {
  return (config?.roles || []).find(role => role.id === roleName) || null;
}

function hasPermission(user, permission, config) {
  if (!user) return false;
  const roleId = user.roleId || user.role;
  const configuredRole = configPermissions(config, roleId);
  if (configuredRole) {
    if (configuredRole.permissions?.['*']?.includes('*') || configuredRole.permissions?.['*']?.includes('administer')) return true;
    const [kind, action = 'view'] = permission.split(':');
    const key = ({ reports: 'reporting', feedback: 'interviews', config: 'organization', users: 'organization' })[kind] || kind;
    const actions = configuredRole.permissions?.[kind] || configuredRole.permissions?.[key] || [];
    if (actions.includes(action) || actions.includes('administer') || actions.includes('*') || configuredRole.permissions?.['*']?.includes(action)) return true;
    if (kind === 'export') return (configuredRole.permissions?.[key] || []).includes('export') || (configuredRole.permissions?.['*'] || []).includes('export');
    if (['salary', 'contact', 'privateNotes', 'feedback'].includes(kind)) return (configuredRole.sensitive || []).includes('*') || (configuredRole.sensitive || []).includes(kind);
    return false;
  }
  return false;
}

const OWNER_KEYS = ['ownerId', 'recruiterId', 'hiringManagerId', 'userId', 'createdBy', 'assignedTo', 'assigneeId', 'authorId', 'coordinatorId', 'sourcingOwnerId', 'backupOwnerId'];
const RELATIONS = {
  applications: [['candidates', 'candidateId'], ['jobs', 'jobId']],
  interviews: [['applications', 'applicationId'], ['candidates', 'candidateId'], ['jobs', 'jobId']],
  feedback: [['interviews', 'interviewId'], ['applications', 'applicationId'], ['candidates', 'candidateId'], ['jobs', 'jobId']],
  notes: [['candidates', 'candidateId'], ['jobs', 'jobId'], ['clients', 'clientId'], ['applications', 'applicationId'], ['offers', 'offerId']],
  tasks: [['candidates', 'candidateId'], ['jobs', 'jobId'], ['interviews', 'interviewId'], ['offers', 'offerId'], ['onboarding', 'onboardingId'], ['clients', 'clientId'], ['placements', 'placementId']],
  documents: [['candidates', 'candidateId'], ['jobs', 'jobId'], ['offers', 'offerId'], ['onboarding', 'onboardingId'], ['clients', 'clientId'], ['placements', 'placementId'], ['invoices', 'invoiceId']],
  submissions: [['clients', 'clientId'], ['contacts', 'contactId'], ['candidates', 'candidateId'], ['jobs', 'jobId']],
  placements: [['submissions', 'submissionId'], ['clients', 'clientId'], ['candidates', 'candidateId'], ['jobs', 'jobId'], ['invoices', 'invoiceId']],
  invoices: [['placements', 'placementId'], ['clients', 'clientId']],
  onboarding: [['offers', 'offerId'], ['applications', 'applicationId'], ['candidates', 'candidateId'], ['jobs', 'jobId']],
  offers: [['applications', 'applicationId'], ['candidates', 'candidateId'], ['jobs', 'jobId']],
  contacts: [['clients', 'clientId']],
  jobs: [['clients', 'clientId']],
  referrals: [['candidates', 'candidateId'], ['jobs', 'jobId']],
  talentPools: [['candidates', 'candidateId']]
};

function recordScope(user, record, config) {
  const role = configPermissions(config, user?.roleId || user?.role);
  const kind = record.__kind;
  const scoped = role?.scopes?.[kind] ?? role?.scopes?.[kind?.replace(/s$/, '')] ?? role?.scope;
  return typeof scoped === 'object' && scoped !== null ? (scoped[kind] ?? scoped.default ?? 'all') : (scoped || 'all');
}

function matchesScope(user, record, scope) {
  if (!scope || scope === 'all') return true;
  if (scope === 'owned' || scope === 'assigned') return OWNER_KEYS.some(key => record[key] != null && record[key] === user.id);
  if (scope === 'department') {
    const values = [record.departmentId, record.department, record.unitId].filter(value => value != null && value !== '');
    return values.some(value => value === user.departmentId || value === user.department || value === user.unitId);
  }
  if (scope === 'location') {
    const values = [record.locationId, record.location, record.officeId].filter(value => value != null && value !== '');
    return values.some(value => value === user.locationId || value === user.location || value === user.officeId);
  }
  return false;
}

function linkedRecords(record, context) {
  if (!context || typeof context.get !== 'function') return [];
  const kind = record.__kind;
  const links = [...(RELATIONS[kind] || [])];
  if (kind === 'notes' || kind === 'documents' || kind === 'tasks') {
    if (record.relatedKind && record.relatedId) links.push([record.relatedKind, 'relatedId']);
  }
  const seen = new Set();
  return links.flatMap(([linkedKind, key]) => {
    const id = key === 'relatedId' ? record.relatedId : record[key];
    if (!id) return [];
    const token = `${linkedKind}:${id}`;
    if (seen.has(token)) return [];
    seen.add(token);
    const linked = context.get(linkedKind, id);
    return linked ? [{ ...linked, __kind: linkedKind }] : [];
  });
}

/**
 * Checks a record against configured role scope. `context` is optional and accepts
 * `{ get(kind, id) }`; when supplied, related records also constrain scoped access.
 * This keeps route code independent of the platform's persistence adapter.
 */
function canAccessRecord(user, record, config, context) {
  if (!hasPermission(user, `${record.__kind || ''}:view`, config)) return false;
  if (record.__kind === 'notifications' && record.userId && record.userId !== user.id && !hasPermission(user, 'notifications:administer', config)) return false;
  if (record.__kind === 'notes' && record.visibility === 'private' && record.authorId !== user.id && !hasPermission(user, 'notes:administer', config)) return false;
  if (record.__kind === 'documents' && !['public', 'team'].includes(record.visibility) && record.ownerId !== user.id && !hasPermission(user, 'documents:administer', config)) return false;
  const scope = recordScope(user, record, config);
  const links = linkedRecords(record, context);
  if (links.some(link => !matchesScope(user, link, recordScope(user, link, config)))) return false;
  if (!matchesScope(user, record, scope) && !links.some(link => matchesScope(user, link, scope))) return false;
  return true;
}

const SALARY_KEYS = new Set(['salary', 'salaryBand', 'currentSalary', 'expectedSalary', 'salaryExpectation', 'currentCompensation', 'baseSalary', 'bonus', 'variableCompensation', 'joiningBonus', 'equity', 'compensation', 'compensationComponents', 'budget']);
const FEE_KEYS = new Set(['fee', 'fees', 'agencyFees', 'placementFee', 'amount', 'invoiceAmount']);
const OFFER_KEYS = new Set(['offerDetails', 'offerDocument', 'offerTemplate', 'compensation', 'compensationComponents', 'salary', 'salaryBand', 'baseSalary', 'bonus', 'variableCompensation', 'joiningBonus', 'equity']);
const CONTACT_KEYS = new Set(['email', 'phone', 'contactInformation', 'personalEmail', 'personalPhone', 'contactEmail', 'contactPhone']);
const CANDIDATE_PII_KEYS = new Set(['alternateEmails', 'alternatePhones', 'profileUrl', 'linkedin', 'portfolio', 'address']);
const PRIVATE_KEYS = new Set(['privateNotes', 'privateNote', 'privateBody', 'hiringRecommendation']);
const FEEDBACK_KEYS = new Set(['score', 'ratings', 'answers', 'feedback', 'recommendation', 'aggregateScore']);

function maskRecord(record, user, config) {
  if (!record || typeof record !== 'object') return record;
  const cloned = structuredClone(record);
  const role = configPermissions(config, user.roleId || user.role);
  const canSensitive = key => role ? role.sensitive?.includes('*') || role.sensitive?.includes(key) : hasPermission(user, `${key}:view`, config);
  const canSalary = canSensitive('salary');
  const canFees = canSensitive('agencyFees') || canSensitive('financialInformation');
  const canOffer = canSensitive('offerDetails') || canSalary;
  const canContacts = canSensitive('contact');
  const canPrivate = canSensitive('privateNotes');
  const canFeedback = canSensitive('feedback');
  const isPrivateNote = record.__kind === 'notes' && record.visibility === 'private' && record.authorId !== user?.id && !hasPermission(user, 'notes:administer', config);
  const visit = (value, candidateContext = record.__kind === 'candidates') => {
    if (Array.isArray(value)) return value.map(item => visit(item, candidateContext));
    if (!value || typeof value !== 'object') return value;
    const candidateProjection = candidateContext || value.__kind === 'candidates' || value.entityType === 'candidate' || value.type === 'candidate';
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (!canSalary && SALARY_KEYS.has(key)) continue;
      if (!canFees && FEE_KEYS.has(key)) continue;
      if (!canOffer && OFFER_KEYS.has(key)) continue;
      if (!canContacts && CONTACT_KEYS.has(key)) continue;
      if (!canContacts && candidateProjection && CANDIDATE_PII_KEYS.has(key)) continue;
      if (!canPrivate && PRIVATE_KEYS.has(key)) continue;
      if (!canFeedback && FEEDBACK_KEYS.has(key)) continue;
      if (isPrivateNote && ['body', 'content', 'text'].includes(key)) continue;
      const childIsCandidate = candidateProjection || ['candidate', 'candidates'].includes(key);
      out[key] = visit(child, childIsCandidate);
    }
    return out;
  };
  return visit(cloned);
}

function moduleEnabled(config, moduleName) {
  const modules = config?.modules;
  if (!modules) return true;
  if (Array.isArray(modules)) return modules.includes(moduleName);
  if (typeof modules === 'object') {
    if (['clients', 'contacts', 'submissions', 'placements'].includes(moduleName)) return modules.agency === true;
    if (moduleName === 'invoices') return modules.agency === true && modules.invoices === true;
    // Operational sub-records are capabilities used by their parent workflows,
    // not independent customer modules. Keep them available unless the customer
    // explicitly disables the capability or all of its owning modules.
    if (Object.prototype.hasOwnProperty.call(modules, moduleName)) return modules[moduleName] === true;
    if (moduleName === 'talentPools') return modules.talentCrm === true;
    if (moduleName === 'workforceTargets') return modules.workforcePlanning === true;
    if (moduleName === 'automations') return modules.automation === true;
    if (moduleName === 'outbox') return modules.integrations !== false;
    if (moduleName === 'reporting') return modules.reporting === true;
    if (moduleName === 'approvals') return modules.requisitions !== false || modules.offers !== false || (modules.agency === true && modules.invoices === true);
    if (moduleName === 'feedback') return modules.interviews !== false;
    if (moduleName === 'notes') return modules.candidates !== false || modules.jobs !== false || modules.agency === true;
    if (moduleName === 'documents') return true;
    if (moduleName === 'savedViews') return true;
    if (moduleName === 'audit') return modules.audit !== false;
    if (moduleName === 'organization') return true;
    return false;
  }
  return true;
}

module.exports = { hasPermission, canAccessRecord, maskRecord, moduleEnabled, recordScope, linkedRecords };
