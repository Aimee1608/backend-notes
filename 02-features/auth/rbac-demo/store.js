'use strict';

// 玩具级内存数据。真实环境这些都在数据库里(users / roles / permissions 等表)。

// 角色 → 权限(对应 role_permissions 表)
const rolePermissions = {
  editor: ['read', 'edit'], // 编辑:能看、能改
  viewer: ['read'],         // 访客:只能看
};

// 用户在"某个资源范围(项目)"里的角色(对应 user_roles + 资源范围)
// 关键:角色是挂在 scope 上的 —— alice 在 projectA 是 editor,不代表在 projectB 也是。
const userRoles = [
  { userId: 'alice', scope: 'projectA', role: 'editor' },
  { userId: 'bob', scope: 'projectA', role: 'viewer' },
  // 注意:alice / bob 在 projectB 都没有任何角色 → 访问 projectB 会被拒。
];

module.exports = { rolePermissions, userRoles };
