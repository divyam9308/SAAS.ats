const { getEmployeeStatus } = require('../services/employeeStatus')
const { emailAllowed } = require('../config/companyConfig')

async function requireAuth(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!emailAllowed(req.user.email)) {
    return res.status(403).json({ code: 'EMAIL_NOT_ALLOWED', error: 'This email account is not permitted.' })
  }
  try {
    const employment = await getEmployeeStatus(req.user.id)
    if (employment?.status === 'inactive' && !req.originalUrl.startsWith('/api/presence/offline')) {
      return res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account has been deactivated.',
        error: 'Your account has been deactivated.'
      })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

module.exports = requireAuth
