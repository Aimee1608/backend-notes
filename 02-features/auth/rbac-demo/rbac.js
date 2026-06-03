'use strict';

const { rolePermissions, userRoles } = require('./store');

// 核心判断:用户 userId 在资源范围 scope 内,有没有 action 权限?
// 步骤:① 找他在这个 scope 的所有角色 → ② 这些角色的权限里有没有 action。
function can(userId, action, scope) {
  const roles = userRoles
    .filter((ur) => ur.userId === userId && ur.scope === scope)
    .map((ur) => ur.role);

  // 没有任何角色 = 不在这个资源范围内 → 直接拒;
  // 有角色 → 看角色的权限里有没有 action。
  return roles.some((role) => (rolePermissions[role] || []).includes(action));
}

module.exports = { can };
