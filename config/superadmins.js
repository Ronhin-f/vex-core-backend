// config/superadmins.js
const list = (process.env.SUPERADMINS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function isSuperadminEmail(email = '') {
  return list.includes(String(email).trim().toLowerCase());
}

module.exports = { isSuperadminEmail, SUPERADMINS_LIST: list };
