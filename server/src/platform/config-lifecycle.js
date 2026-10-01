'use strict';

const { validateConfig } = require('../../../shared/ats-config.cjs');
const { now } = require('./database');

const COMPANY_ID = 'local-company';

class ConfigurationValidationError extends Error {
  constructor(validation) {
    super('Configuration is invalid');
    this.name = 'ConfigurationValidationError';
    this.status = 422;
    this.details = validation.errors || [];
    this.warnings = validation.warnings || [];
  }
}

function syncConfiguredUsers(db, config, companyId = COMPANY_ID) {
  db.prepare('DELETE FROM platform_users WHERE company_id=?').run(companyId);
  for (const user of config.users || []) {
    const role = config.roles?.find(item => item.id === user.roleId);
    const unit = config.organization?.units?.find(item => item.id === user.departmentId);
    const location = config.organization?.locations?.find(item => item.id === user.locationId);
    db.prepare('INSERT INTO platform_users(company_id,id,data) VALUES(?,?,?)').run(companyId, user.id, JSON.stringify({
      ...user,
      role: user.roleId,
      roleName: role?.name || user.roleId,
      department: unit?.name || '',
      location: location?.name || '',
    }));
  }
}

function activateConfiguration(db, {
  config,
  actorId,
  note = 'Activated draft',
  companyId = COMPANY_ID,
  audit,
} = {}) {
  const validation = validateConfig(config);
  if (!validation.valid) throw new ConfigurationValidationError(validation);

  const current = db.prepare('SELECT active_version FROM platform_config WHERE company_id=?').get(companyId);
  if (!current) throw new Error(`Platform configuration for ${companyId} has not been initialized.`);

  const timestamp = now();
  const version = Number(current.active_version) + 1;
  const serialized = JSON.stringify(config);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE platform_config SET active=?,draft=?,active_version=?,updated_at=? WHERE company_id=?')
      .run(serialized, serialized, version, timestamp, companyId);
    db.prepare('INSERT INTO platform_config_versions(company_id,version,config,actor_id,created_at,note) VALUES(?,?,?,?,?,?)')
      .run(companyId, version, serialized, actorId, timestamp, note);
    syncConfiguredUsers(db, config, companyId);
    audit?.('configuration.activated', 'config', null, { version });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { version, config, warnings: validation.warnings || [] };
}

module.exports = {
  COMPANY_ID,
  ConfigurationValidationError,
  activateConfiguration,
  syncConfiguredUsers,
};
