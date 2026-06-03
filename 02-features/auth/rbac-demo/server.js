'use strict';

// 最小权限系统:演示 RBAC + 资源范围 + 校验中间件。
//   GET  /projects/:pid/articles   需要 read 权限(在 pid 这个范围内)
//   POST /projects/:pid/articles   需要 edit 权限(在 pid 这个范围内)
//
// 简化:用户身份用请求头 x-user-id 模拟。真实环境 user 来自 token / session(见第一篇)。

const express = require('express');
const { can } = require('./rbac');

const app = express();
app.use(express.json());

// 权限校验中间件:要求当前用户在"这个项目(资源范围)"里有 action 权限。
function requirePermission(action) {
  return (req, res, next) => {
    const userId = req.headers['x-user-id']; // 模拟身份
    const scope = req.params.pid;            // 资源范围 = 项目 id
    if (!userId) return res.status(401).json({ error: 'missing_user' });
    if (!can(userId, action, scope)) {
      // 拒绝有两种原因:角色没这个权限、或根本不在这个资源范围内。统一 403。
      return res.status(403).json({ error: 'forbidden', need: action, scope });
    }
    next();
  };
}

// 看文章:要 read 权限
app.get('/projects/:pid/articles', requirePermission('read'), (req, res) => {
  res.json({ ok: true, action: 'read', project: req.params.pid, user: req.headers['x-user-id'] });
});

// 改文章:要 edit 权限
app.post('/projects/:pid/articles', requirePermission('edit'), (req, res) => {
  res.json({ ok: true, action: 'edit', project: req.params.pid, user: req.headers['x-user-id'] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rbac demo listening on http://localhost:${PORT}`));

module.exports = app;
