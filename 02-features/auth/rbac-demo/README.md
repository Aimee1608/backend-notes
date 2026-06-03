# rbac-demo

最小的 **RBAC + 资源范围**权限 demo:`用户 → 角色 → 权限`,且角色挂在"资源范围(项目)"上。

> 简化:用户身份用 `x-user-id` 请求头模拟(真实环境身份来自 token / session,见上层第一篇)。

## 数据(在 `store.js`)
- 角色权限:`editor = [read, edit]`;`viewer = [read]`
- 用户角色:**alice 在 projectA 是 editor**;**bob 在 projectA 是 viewer**;两人在 **projectB 都没角色**。

## 跑起来
```bash
npm install
npm start
```

## 试一试(curl,看 RBAC + 资源范围怎么拦)
```bash
# alice 看 projectA → 200(editor 有 read)
curl -s localhost:3000/projects/projectA/articles -H 'x-user-id: alice'

# bob 看 projectA → 200(viewer 有 read)
curl -s localhost:3000/projects/projectA/articles -H 'x-user-id: bob'

# bob 改 projectA → 403(viewer 没 edit 权限)—— 这是 RBAC 拦的
curl -s -X POST localhost:3000/projects/projectA/articles -H 'x-user-id: bob'

# alice 改 projectA → 200(editor 有 edit)
curl -s -X POST localhost:3000/projects/projectA/articles -H 'x-user-id: alice'

# alice 改 projectB → 403(alice 在 projectB 没角色)—— 这是"资源范围"拦的
curl -s -X POST localhost:3000/projects/projectB/articles -H 'x-user-id: alice'
```

最后两条最关键:**同样是 alice,在 projectA 能改、在 projectB 不能** —— 这就是"权限挂在资源范围上"。

## 文件
- `store.js` — 角色权限 & 用户角色(挂 scope)
- `rbac.js` — 核心判断 `can(user, action, scope)`
- `server.js` — 路由 + 权限校验中间件
