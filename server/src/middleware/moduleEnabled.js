const { moduleEnabled } = require('../config/companyConfig')

module.exports = function requireModule(key) {
  return (req, res, next) => moduleEnabled(key) ? next() : res.status(404).json({ error: 'Module is not enabled.' })
}

