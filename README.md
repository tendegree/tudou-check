# 土豆AI 每日自动签到

针对 tudouai.cn 的每日自动签到脚本（Geese 互动答题签到 + 社区签到 + 分享任务）。

## 功能

| 任务 | 接口 | 说明 |
|---|---|---|
| 社区签到 | `POST /client/forum/user/sign` | 空请求体，幂等 |
| 分享任务 | `POST /client/resource/task/daily-share` | 空请求体，幂等 |
| 每日签到-答题 | `GET /resource/qa-captcha/generate` + `POST /system/sign` | 题库优先 + 盲蒙重试(≤10次) |

## 使用

```bash
TUDOUAI_TOKEN=<localStorage 的 Admin-Token> node sign.js
```

## 部署

- GitHub Actions：`.github/workflows/daily-sign.yml`（每天 08:00 北京时间）
- 凭据存 Secrets：`TUDOUAI_TOKEN`

## 文件

- `sign.js`：主入口（三条签到链路）
- `src/config.js`：端点与常量
- `src/auth.js`：登录加密（已弃用自动登录，改 token 直连）
- `src/mc-bank.js`：MC 答题题库（可增补）

详见 `SIGNUP_PLAN.md`。