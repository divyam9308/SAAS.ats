import assert from 'node:assert/strict'

// Invoked by browser-acceptance.mjs after the public applicant and resume have
// been created. All writes below go through the visible ATS forms/actions; the
// API helper is used only to choose existing linked records and verify storage.
export async function verifyCorporateWorkflow({ page, api, check }) {
  const unique = `Browser Corporate ${Date.now()}`
  const bootstrap = await api('/bootstrap')
  const users = bootstrap.users || bootstrap.config?.users || []
  const hiringManager = users.find(user => (user.roleId || user.role) === 'hiring-manager')
  const applicant = (await api('/records/candidates')).find(candidate => candidate.email === 'browser-applicant@example.test')
  assert.ok(applicant, 'Public Browser Test Applicant should exist')
  const applicantLabel = applicant.name || applicant.fullName || [applicant.firstName, applicant.lastName].filter(Boolean).join(' ')
  assert.ok(applicantLabel, 'Public applicant should have a display name')
  const modal = () => page.locator('.platform-modal[role="dialog"]')
  const namedControl = (container, name) => container.locator(`[name="${name}"]`)
  const closeDetails = async () => {
    const drawer = page.locator('.platform-record-drawer')
    if (await drawer.isVisible().catch(() => false)) {
      await drawer.getByRole('button', { name: 'Close details', exact: true }).click()
      await drawer.waitFor({ state: 'hidden' })
    }
  }
  const clickNav = async (name) => {
    await closeDetails()
    const target = page.locator('.platform-nav-link').filter({ hasText: new RegExp(`^${name}$`) })
    try { await target.click({ timeout: 2_000 }) }
    catch (error) {
      if (!await page.locator('.platform-drawer-backdrop').isVisible().catch(() => false)) throw error
      await closeDetails()
      await target.click()
    }
  }
  const rowFor = (text) => page.locator('.platform-table tbody tr').filter({ hasText: text }).first()
  const selectFirst = async (container, name) => {
    const select = namedControl(container, name)
    const options = await select.locator('option').evaluateAll(items => items.filter(option => option.value).map(option => option.value))
    assert.ok(options.length, `Expected an available choice for ${name}`)
    await select.selectOption(options[0])
    return options[0]
  }
  const switchToRole = async (roleId) => {
    const user = users.find(item => (item.roleId || item.role) === roleId)
    assert.ok(user, `Configured demo user for role ${roleId} should be available`)
    await closeDetails()
    await page.locator('.platform-user-button').click()
    await page.locator('.platform-user-menu button').filter({ hasText: user.name }).click()
    await page.locator('.platform-user-copy strong').getByText(user.name, { exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: `Now viewing as ${user.name}` }).waitFor()
  }
  const waitDialogClosed = () => modal().waitFor({ state: 'hidden' })
  const approveThroughWorkflow = async (kind, record) => {
    let current = record
    const roles = Array.isArray(current.approvals) ? current.approvals : []
    const indexes = Array.isArray(current.approvalStepIndexes) ? current.approvalStepIndexes : []
    for (let index = indexes.length; index < roles.length; index += 1) {
      await switchToRole(roles[index])
      let targetRow
      if (kind === 'offers') {
        const actor = users.find(user => (user.roleId || user.role) === roles[index])
        const projected = actor && (await api(`/records/${kind}`, undefined, 'GET', actor.id)).find(item => item.id === current.id)
        const displayLabel = projected?.candidateName && projected.candidateName !== 'Candidate unavailable'
          ? projected.candidateName
          : (projected?.jobTitle || current.jobTitle)
        const salaryText = Number.isFinite(Number(current.salary))
          ? String(Math.trunc(Number(current.salary))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
          : ''
        const offerRows = page.locator('.platform-table tbody tr')
        targetRow = displayLabel ? offerRows.filter({ hasText: displayLabel }) : offerRows
        if (salaryText) targetRow = targetRow.filter({ hasText: salaryText })
        if (await targetRow.count() !== 1 && await offerRows.count() === 1) targetRow = offerRows.first()
      } else targetRow = rowFor(current.title)
      await targetRow.getByRole('button', { name: 'Approve', exact: true }).click()
      const dialog = modal()
      await dialog.getByRole('button', { name: 'Approve request', exact: true }).click()
      await waitDialogClosed()
      current = (await api(`/records/${kind}`)).find(item => item.id === current.id)
      assert.ok(current, `Approved ${kind} record remains persisted`)
      if (current.status === (kind === 'offers' ? 'sent' : 'approved')) break
    }
    return current
  }
  const clickRowAction = async (text, action) => {
    await closeDetails()
    const row = rowFor(text)
    await row.getByRole('button', { name: action, exact: true }).click()
  }

  await check('Corporate hiring request approval creates and publishes a job', async () => {
    await clickNav('Hiring requests')
    await page.getByRole('button', { name: 'Add hiring request', exact: true }).click()
    const dialog = modal()
    await namedControl(dialog, 'title').fill(`${unique} · Platform Engineer`)
    const departmentSelect = namedControl(dialog, 'departmentId')
    const hiringDepartmentId = hiringManager?.departmentId
    const departmentOptions = await departmentSelect.locator('option').evaluateAll(items => items.map(option => ({ value: option.value, label: option.textContent.trim() })).filter(option => option.value))
    const departmentValue = departmentOptions.find(option => option.value === hiringDepartmentId)?.value
      || departmentOptions.find(option => hiringManager?.department && option.label === hiringManager.department)?.value
    assert.ok(departmentValue, 'A department matching the configured hiring manager is available')
    await departmentSelect.selectOption(departmentValue)
    await selectFirst(dialog, 'locationId')
    await namedControl(dialog, 'headcount').fill('1')
    await namedControl(dialog, 'justification').fill('Browser acceptance workflow for a corporate hiring request.')
    await selectFirst(dialog, 'employmentType')
    await selectFirst(dialog, 'urgency')
    await dialog.getByRole('button', { name: 'Create hiring request', exact: true }).click()
    await waitDialogClosed()
    let requisition = (await api('/records/requisitions')).find(item => item.title === `${unique} · Platform Engineer`)
    assert.ok(requisition, 'Hiring request should be persisted after the UI form submission')
    assert.ok(['pending', 'approved'].includes(requisition.status), `Unexpected initial request status: ${requisition.status}`)
    if (requisition.status !== 'approved') requisition = await approveThroughWorkflow('requisitions', requisition)
    assert.equal(requisition.status, 'approved')
    await switchToRole('admin')
    await clickRowAction(requisition.title, 'Create job')
    await modal().getByRole('button', { name: 'Save', exact: true }).click()
    await waitDialogClosed()
    await page.locator('.platform-breadcrumb strong').getByText('Jobs', { exact: true }).waitFor()
    let job = (await api('/records/jobs')).find(item => item.requisitionId === requisition.id)
    assert.ok(job, 'Creating the approved request should persist a linked job')
    assert.equal(job.status, 'draft')
    await closeDetails()
    await clickNav('Jobs')
    await clickRowAction(job.title, 'Publish')
    await modal().getByRole('button', { name: 'Publish', exact: true }).click()
    await waitDialogClosed()
    job = (await api('/records/jobs')).find(item => item.id === job.id)
    assert.ok(['open', 'published'].includes(job.status), `Expected published/open job, got ${job.status}`)
    const audit = await api('/records/audit')
    assert.ok(audit.some(event => event.action === 'requisition.job-created' && event.recordId === requisition.id))
  })

  await check('Candidate pipeline move enforces stage rules', async () => {
    const applications = await api('/records/applications')
    const application = applications.find(item => item.candidateId === applicant.id)
    assert.ok(application, 'Public applicant application should exist')
    await clickNav('Applications')
    const appRow = page.locator('.platform-table tbody tr').filter({ hasText: applicantLabel }).first()
    await appRow.getByRole('button', { name: 'Move stage', exact: true }).click()
    const stage = namedControl(modal(), 'stage')
    const nextStage = (await stage.locator('option').evaluateAll(items => items.filter(option => option.value).map(option => option.value)))[0]
    assert.ok(nextStage, 'Application should expose a configured next stage')
    await stage.selectOption(nextStage)
    await modal().getByRole('button', { name: 'Save', exact: true }).click()
    await waitDialogClosed()
    const updated = (await api('/records/applications')).find(item => item.id === application.id)
    assert.equal(updated.stage, nextStage)
    assert.ok(Array.isArray(updated.stageHistory) && updated.stageHistory.length >= 2)
  })

  await check('Interview scheduling and scorecard submission persist feedback', async () => {
    const app = (await api('/records/applications')).find(item => item.candidateId === applicant?.id)
    assert.ok(app, 'Applicant application should remain available')
    await clickNav('Interviews')
    await page.getByRole('button', { name: 'Add interview', exact: true }).click()
    const dialog = modal()
    await namedControl(dialog, 'applicationId').selectOption(String(app.id))
    if (await namedControl(dialog, 'interviewPlanId').count()) await selectFirst(dialog, 'interviewPlanId')
    if (await namedControl(dialog, 'roundId').count()) await selectFirst(dialog, 'roundId')
    if (await namedControl(dialog, 'scorecardId').count()) await selectFirst(dialog, 'scorecardId')
    await selectFirst(dialog, 'type')
    const dateTime = dialog.locator('input[type="datetime-local"]')
    await dateTime.fill('2030-06-12T10:00')
    await namedControl(dialog, 'durationMinutes').fill('45')
    await dialog.getByRole('button', { name: 'Create interview', exact: true }).click()
    await waitDialogClosed()
    let interview = (await api('/records/interviews')).find(item => item.applicationId === app.id)
    assert.ok(interview, 'Scheduled interview should persist')
    assert.ok(interview.scheduledAt)
    const interviewRow = page.locator('.platform-table tbody tr').filter({ hasText: applicantLabel }).first()
    await interviewRow.getByRole('button', { name: 'Submit feedback', exact: true }).click()
    const action = modal()
    const ratings = await action.locator('select[name^="rating_"]').all()
    assert.ok(ratings.length > 0, 'Configured scorecard competencies should be presented')
    for (const rating of ratings) await rating.selectOption('4')
    const recommendation = namedControl(action, 'recommendation')
    const recommendationValue = await recommendation.locator('option').nth(1).getAttribute('value')
    await recommendation.selectOption(recommendationValue)
    await namedControl(action, 'comments').fill('Clear evidence of role-relevant problem solving.')
    await action.getByRole('button', { name: 'Save', exact: true }).click()
    await waitDialogClosed()
    interview = (await api('/records/interviews')).find(item => item.id === interview.id)
    const feedback = (await api('/records/feedback')).find(item => item.interviewId === interview.id && item.status === 'submitted')
    assert.ok(feedback, 'Submitted scorecard feedback should persist')
    assert.ok(Object.values(feedback.answers).every(value => value === 4), 'Configured ratings should persist as numbers')
    assert.equal(interview.status, 'completed')
  })

  await check('Offer approval, acceptance and onboarding checklist are persisted', async () => {
    const app = (await api('/records/applications')).find(item => item.candidateId === applicant?.id)
    assert.ok(app && applicant, 'Applicant and linked job application should exist')
    await clickNav('Offers')
    await page.getByRole('button', { name: 'Add offer', exact: true }).click()
    const dialog = modal()
    await namedControl(dialog, 'candidateId').selectOption(String(app.candidateId))
    await namedControl(dialog, 'jobId').selectOption(String(app.jobId))
    await namedControl(dialog, 'salary').fill('120000')
    await namedControl(dialog, 'currency').fill('USD')
    await dialog.getByRole('button', { name: 'Create offer', exact: true }).click()
    await waitDialogClosed()
    let offer = (await api('/records/offers')).find(item => item.candidateId === applicant.id && item.jobId === app.jobId && Number(item.salary) === 120000)
    assert.ok(offer, 'Offer should persist after UI creation')
    const offerRow = page.locator('.platform-table tbody tr').filter({ hasText: applicantLabel }).first()
    assert.ok(await offerRow.count(), 'The applicant offer should be visible in the offer list')
    offer = await approveThroughWorkflow('offers', offer)
    assert.equal(offer.status, 'sent')
    // The CEO is an approver but the workflow role intentionally has no offer
    // edit permission. Switch to the admin persona for the acceptance action.
    await switchToRole('admin')
    await page.locator('.platform-table tbody tr')
      .filter({ hasText: applicantLabel })
      .first()
      .getByRole('button', { name: 'Accept', exact: true }).click()
    await modal().getByRole('button', { name: 'Accept', exact: true }).click()
    await waitDialogClosed()
    offer = (await api('/records/offers')).find(item => item.id === offer.id)
    assert.equal(offer.status, 'accepted')
    const onboarding = (await api('/records/onboarding')).find(item => item.offerId === offer.id)
    assert.ok(onboarding, 'Accepting an offer should create an onboarding plan')
    assert.ok(Array.isArray(onboarding.checklist))
    assert.ok((await api('/records/audit')).some(event => event.action === 'offer.accepted' && event.recordId === offer.id))
    await switchToRole('admin')
  })

  await check('Corporate workflow tasks and notifications are persisted', async () => {
    await clickNav('Tasks')
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    const taskDialog = modal()
    const taskTitle = `${unique} · Follow up with hiring team`
    await namedControl(taskDialog, 'title').fill(taskTitle)
    if (await namedControl(taskDialog, 'priority').count()) await selectFirst(taskDialog, 'priority')
    await taskDialog.getByRole('button', { name: 'Create task', exact: true }).click()
    await waitDialogClosed()
    const tasks = await api('/records/tasks')
    const savedTask = tasks.find(task => task.title === taskTitle)
    assert.ok(savedTask, 'Task created through the UI should persist')
    const notifications = await api('/records/notifications')
    assert.ok(notifications.some(item => item.title === 'New application received'), 'Seeded in-app notification should be readable from persisted records')
    const audit = await api('/records/audit')
    assert.ok(audit.some(event => event.action === 'record.created' && event.kind === 'tasks' && event.recordId === savedTask.id), 'Task creation should be audited')
    assert.ok(audit.some(event => ['interview.feedback-submitted', 'offer.accepted', 'application.stage-changed'].includes(event.action)))
    await page.locator('.platform-breadcrumb strong').getByText('Tasks', { exact: true }).waitFor()
    await clickNav('Notifications')
    await page.locator('.platform-breadcrumb strong').getByText('Notifications', { exact: true }).waitFor()
    await page.getByText('New application received', { exact: true }).waitFor()
  })

  await check('Application rejection and withdrawal persist configured and optional reason categories', async () => {
    const jobId = (await api('/records/applications')).find(item => item.candidateId === applicant.id)?.jobId
    assert.ok(jobId, 'An existing configured job should be available')
    for (const actionName of ['reject', 'withdraw']) {
      const firstName = `Decision ${actionName}`
      const lastName = String(Date.now())
      const email = `${actionName}-${lastName}@example.test`
      await clickNav('Candidates')
      await page.getByRole('button', { name: 'Add candidate', exact: true }).click()
      await namedControl(modal(), 'firstName').fill(firstName)
      await namedControl(modal(), 'lastName').fill(lastName)
      await namedControl(modal(), 'email').fill(email)
      await modal().getByRole('button', { name: 'Create candidate', exact: true }).click()
      await waitDialogClosed()
      const candidate = (await api('/records/candidates')).find(item => item.email === email)
      assert.ok(candidate, 'Decision journey candidate should persist')
      await clickNav('Applications')
      await page.getByRole('button', { name: 'Add application', exact: true }).click()
      await namedControl(modal(), 'candidateId').selectOption(candidate.id)
      await namedControl(modal(), 'jobId').selectOption(jobId)
      await modal().getByRole('button', { name: 'Create application', exact: true }).click()
      await waitDialogClosed()
      const application = (await api('/records/applications')).find(item => item.candidateId === candidate.id)
      assert.ok(application, 'Decision journey application should persist')
      await rowFor(firstName).getByRole('button', { name: actionName === 'reject' ? 'Reject' : 'Withdraw', exact: true }).click()
      const category = namedControl(modal(), 'reasonCategory')
      const categories = bootstrap.config.taxonomies[actionName === 'reject' ? 'rejectionReasons' : 'withdrawalReasons']
      assert.ok(categories.length, 'Decision categories should come from configuration')
      await category.selectOption(categories[0])
      if (actionName === 'withdraw') await category.selectOption('')
      const reason = 'Synthetic decision recorded through the visible application form.'
      await namedControl(modal(), 'reason').fill(reason)
      await modal().getByRole('button', { name: actionName === 'reject' ? 'Reject request' : 'Withdraw', exact: true }).click()
      await waitDialogClosed()
      const saved = (await api('/records/applications')).find(item => item.id === application.id)
      const status = actionName === 'reject' ? 'rejected' : 'withdrawn'
      const reasonCategory = actionName === 'reject' ? categories[0] : null
      assert.equal(saved.status, status)
      assert.equal(saved.endReason, reason)
      assert.equal(saved.endReasonCategory, reasonCategory)
      assert.ok((await api('/records/audit')).some(event => event.action === `application.${status}` && event.recordId === saved.id && event.details?.reasonCategory === reasonCategory), 'Decision category should be audited')
    }
  })
}
