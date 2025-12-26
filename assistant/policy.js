const ROLE_RANK = {
  user: 1,
  admin: 2,
  owner: 3,
  superadmin: 4,
};

function roleRank(role) {
  return ROLE_RANK[String(role || '').toLowerCase()] || 0;
}

function canPerform(user, action, moduleName) {
  if (!user) return false;
  const role = String(user.rol || '').toLowerCase();
  if (role === 'superadmin' || user.isSuperadmin) return true;

  if (moduleName === 'core') {
    if (['invite_user', 'resend_invite', 'reset_password'].includes(action)) {
      return roleRank(role) >= ROLE_RANK.admin;
    }
  }

  return roleRank(role) >= ROLE_RANK.user;
}

module.exports = { canPerform };
