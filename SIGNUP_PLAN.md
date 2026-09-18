# tudouai.cn 自动签到计划（SIGNUP_PLAN）

## 1. 目标
使用 **GitHub Actions** 每日自动执行：
1. 登录 tudouai.cn
2. 社区答题签到
3. 个人中心答题签到
4. 完成分享任务（资源中心选一个帖子触发分享）

## 2. 技术选型
- 部署：**GitHub Actions**（仓库内 `.github/workflows/daily-sign.yml`，`schedule` cron 定时触发）
- 运行：**Node.js**（`requests` 风格，只需内置 `fetch`，免额外依赖）
- 凭据：`TUDOUAI_USERNAME` / `TUDOUAI_PASSWORD` 存入 **GitHub Actions Secrets**，不硬编码
- 分发：main 分支；失败自动通知（issue 或 Telegram/邮件 webhook，可后配）

## 3. 已确认的接口契约（调研结论）

### 鉴权方式：JWT，非会话 Cookie
- 登录接口返回 **JWT**（浏览器存于 localStorage 的 `Admin-Token`，字段含登录类型、登录 ID、用户 ID、昵称等）
- 实际使用：**用 `TUDOUAI_TOKEN`（手动从 localStorage 提取的 JWT）直连**，绕开冷 IP 自动登录撞图形验证码
- 日常签到接口只需请求头带 `Authorization: Bearer <jwt>` + `clientid`（固定常量）

| 环节 | 接口 | 请求体 | 完成/成功判定 | 状态 |
|---|---|---|---|---|
| 登录 | `POST /auth/pterodactylLogin`（RuoYi 加密：body=AES·ECB、头 encrypt-key=RSA） | 加密 JSON | 返回 JWT | ⚠️ 冷 IP 触发图形验证码，弃用自动登录 |
| 社区签到 | `POST /client/forum/user/sign` | 空 | 已签`code:500 今日已签到`；已实现幂等 | ✅ 完成 |
| 分享任务 | `POST /client/resource/task/daily-share` | 空 | 已领`code:500 今日分享奖励已领取`；幂等 | ✅ 完成 |
| 每日签到-答题档 | `GET /resource/qa-captcha/generate?game=minecraft` → `POST /system/sign` | `{useQaCaptcha:true, uuid, captchaAnswer}` | 答对`code:200 签到成功！获得土豆:5`；答错`code:500 答题验证码错误`→换题重试(上限10次) | ✅ 完成（题库优先+盲蒙） |
| 每日签到-群消息档 | `POST /system/sign`（不带 useQaCaptcha） | 空 | 返回 QQ 命令`请到官方QQ群发送命令：.签到 <n>` | 🔴 弃用，需人工去群里发命令 |

## 4. 执行流程（伪代码）

```
daily                                  # 每天 08:00(北京时间) 由 Actions cron 触发
  1. 载入 TUDOUAI_TOKEN（localStorage 的 Admin-Token，手动提取，非自动登录）
  2. 社区签到        POST client/forum/user/sign                  → 空 body；已签=幂等成功
  3. 分享任务        POST client/resource/task/daily-share        → 空 body；已领=幂等成功
  4. 答题签到(每日)  GET resource/qa-captcha/generate → POST system/sign {useQaCaptcha,uuid,captchaAnswer}
                     题库命中→直接答对；未命中→盲蒙1个选项；答错→换题重试，上限10次
  5. 收尾
     输出结构化 JSON 到 Actions 运行日志（含各步 attempts 明细）
     任一步真实失败 → process.exitCode=1 触发失败通知
```

**幂等**：社区签到/分享任务已完成时返回明确"今日已..."提示，脚本判定为成功（非失败），不可重复领取也不误报。

## 5. 待办 / 维护项（无阻塞项，核心链路已闭环）

1. **答题签到题库（非阻塞，盲蒙保底）**
   - 答案不在前端（已扫描主 bundle + 全部 148 个懒加载 chunk，均无题干/答案字面量，由服务端校验）
   - `src/mc-bank.js` 收录常用题；未命中则盲蒙选项（4 选项，单次 25%，10 次全蒙命中率约 94%），题库命中可进一步提高成功率
   - 维护方式：遇到未收录新题，人工补充题干关键词 → 正确选项 到 `mc-bank.js`

2. **每日签到-群消息档不可自动化**
   - `POST /system/sign`（不带 useQaCaptcha 时）只返回 QQ 群命令，需登录官方 QQ 群发送命令由机器人确认，纯脚本做不到；已有答题档覆盖，无需处理

3. **凭据续期**
   - `TUDOUAI_TOKEN`（JWT）会过期，过期后 Actions 签到将失败；需重新从 localStorage 提取并更新 GitHub Secret。已留 `workflow_dispatch` 手动触发测试入口

## 6. 里程碑
- [x] M1：确认鉴权方案（JWT + TUDOUAI_TOKEN 直连，绕开冷 IP 验证码）
- [x] M2：社区签到模块（空 body 幂等）跑通
- [x] M3：分享任务模块（空 body 幂等）跑通
- [x] M4：每日签到-答题档（generate → system/sign，题库优先 + 盲蒙重试 ≤10 次）跑通
- [x] M5：接入 GitHub Actions cron + Secrets（TUDOUAI_TOKEN）+ 失败通知
- [ ] M6：连跑 3 天验证幂等与稳定性（待观测）

## 7. 未决 / 需要用户配合
- GitHub Actions Secret `TUDOUAI_TOKEN` 需配置（登录后从 localStorage 的 `Admin-Token` 提取）
- 作答题库需长期人工维护（盲蒙兜底可保证大部分天数成功）
- 通知通道（issue / webhook）默认用 issue 失败通知，可改