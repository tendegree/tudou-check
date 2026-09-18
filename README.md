# 土豆每日自动签到

针对 tudouai.cn 的每日自动签到脚本：社区签到 + 分享任务 + 个人中心答题签到（签到发土豆）。

## 功能

| 任务      | 接口                                                        | 说明                |
| ------- | --------------------------------------------------------- | ----------------- |
| 社区签到    | `POST /client/forum/user/sign`                            | 空请求体，幂等           |
| 分享任务    | `POST /client/resource/task/daily-share`                  | 空请求体，幂等           |
| 每日签到-答题 | `GET /resource/qa-captcha/generate` + `POST /system/sign` | 题库优先 + 盲蒙重试(≤10次) |

三个任务都通过 `Authorization: Bearer <JWT>` + 固定 `clientid` 认证，无需手动答题、无需二次验证。

**支持多账号**：每个账号独立完成三任务，互不影响。另外脚本在每个操作之间会自动停顿 5～8 秒（模拟真人节奏、降低被风控/验证码拦截的概率），所以多账号整体跑下来会比单账号多花几分钟，属正常现象。

## 凭据优先级（自动运维）

对**每个账号**按下面的顺序取 JWT，实现「少登录、自动续期」：

1. **复用旧 JWT**：该账号有 TOKEN 就先用它跑任务；
2. **失效检测**：任一任务返回 401/认证失败 → 判定 token 失效；
3. **自动登录**：用该账号的密码走 RuoYi 网关
   `POST /auth/pterodactylLogin`（AES+RSA 加密，body 含 `datetime`/`grantType="pterodactyl"`）换新 JWT；
4. **写回密钥**：用 `GH_PAT` 调用 `gh secret set` 更新该账号的 TOKEN secret，供下次复用；
5. **重跑任务**（用新 JWT）。

这样只有 JWT 过期/失效时才登录一次，其余每次运行直接复用，避免冷 IP 触发验证码。

## 本地运行

```bash
# 方式一：只给账号密码，脚本自动登录
TUDOUAI_USERNAME="你的账号" TUDOUAI_PASSWORD="你的密码" node sign.js

# 方式二：直接给 JWT（自动登录的兜底）
# LocalStorage 里的 Admin-Token，如 TUDOUAI_TOKEN="eyJ..." node sign.js

# 方式一 + 方式二组合：优先复用 JWT，失效时自动登录换新

# 多账号：用序号分组（账号用哪个方式配置都行，token 可留空自动登录）
TUDOUAI_ACCOUNT1_USERNAME="帐1" TUDOUAI_ACCOUNT1_PASSWORD="密1" \
TUDOUAI_ACCOUNT2_USERNAME="帐2" TUDOUAI_ACCOUNT2_PASSWORD="密2" TUDOUAI_ACCOUNT2_TOKEN="eyJ..." \
node sign.js
```

## 部署（GitHub Actions）

首先 Fork 本仓库

定时任务见 `.github/workflows/daily-sign.yml`（每天 08:00 北京时间）。

### 配置 Secrets

**单账号**（3 + 1 个）：用下面的名字直接加。

**多账号**：给每个账号用**序号后缀**分组（从 `1` 开始连续编号），脚本会自动按 1、2、3… 逐个签到：

| 账号   | 用户名 Secret                  | 密码 Secret                   | Token Secret（可留空）        |
| ---- | --------------------------- | --------------------------- | ------------------------ |
| 账号 1 | `TUDOUAI_ACCOUNT1_USERNAME` | `TUDOUAI_ACCOUNT1_PASSWORD` | `TUDOUAI_ACCOUNT1_TOKEN` |
| 账号 2 | `TUDOUAI_ACCOUNT2_USERNAME` | `TUDOUAI_ACCOUNT2_PASSWORD` | `TUDOUAI_ACCOUNT2_TOKEN` |
| 账号 3 | `TUDOUAI_ACCOUNT3_USERNAME` | `TUDOUAI_ACCOUNT3_PASSWORD` | `TUDOUAI_ACCOUNT3_TOKEN` |
| …    | …                           | …                           | …                        |

> 想加第几个账号，就把序号替换成几。已配置的账号必须**连续编号**（不能 1、3 跳过 2）。
> 单账号配置 `TUDOUAI_*`（无序号）和序号账号可以同时存在，都会执行；一般二选一即可。

公共的 `GH_PAT` 只需配一份，用来自动轮换所有账号的 TOKEN：

| Secret                        | 必填 | 说明                                                      |
| ----------------------------- | -- | ------------------------------------------------------- |
| `TUDOUAI_ACCOUNT{n}_USERNAME` | ✅  | 第 n 个 tudouai.cn 登录**账号**（单账号则用 `TUDOUAI_USERNAME`）     |
| `TUDOUAI_ACCOUNT{n}_PASSWORD` | ✅  | 第 n 个登录**密码**（单账号则用 `TUDOUAI_PASSWORD`）                 |
| `TUDOUAI_ACCOUNT{n}_TOKEN`    | 建议 | 第 n 个账号当前有效 JWT。首次可留空，脚本会自动登录并写回（单账号则用 `TUDOUAI_TOKEN`） |
| `GH_PAT`                      | 建议 | 有 **secrets 读写权限**的 Personal Access Token，用于自动轮换 TOKEN  |

> `GITHUB_REPOSITORY`（`owner/repo`）由 Actions 自动注入，无需手动配置。

#### 小白的图文步骤

1. **打开仓库设置**：进你的 GitHub 仓库 → 点顶部 **Settings**（设置）。
2. **进 Secrets**：左侧菜单选 **Secrets and variables → Actions**。
3. **新建 Secret**：点绿色按钮 **New repository secret**。
4. **单账号**：依次添加 4 个 Secret（每次「名称 + 值」各填一次，填完点 **Add secret**）：

   - `TUDOUAI_USERNAME` = 你的 tudouai.cn 登录**账号**

   - `TUDOUAI_PASSWORD` = 你的 tudouai.cn 登录**密码**

   - `TUDOUAI_TOKEN` = 当前有效 JWT（可留空，见下方说明）

   - `GH_PAT` = 下面的 Personal Access Token
5. **多账号**：账号 1 用 `TUDOUAI_ACCOUNT1_USERNAME` / `TUDOUAI_ACCOUNT1_PASSWORD` / `TUDOUAI_ACCOUNT1_TOKEN`，账号 2 用序号 2，依此类推；`GH_PAT` 仍然只配一份。

#### 怎么创建 GH\_PAT（自动换 token 用，可选）

`GH_PAT` 用来自动更新仓库里的 `TUDOUAI_TOKEN`，这样 token 过期了脚本能自己续上，你就不用管了。**不配置也能用**，只是 token 过期后要手动来填一次。

创建步骤：

1. 打开 <https://github.com/settings/tokens>（右上角头像 → Settings → Developer settings → Personal access tokens）。
2. 点 **Generate new token**（新页面，推荐选 *Fine-grained* 或 *classic* 都行）。
3. Repository access ：**Only select repositories,选择当前fork的仓库**
4. **classic 模式**：

   - 勾选 **`repo`** 整个权限（内含 secrets 读写）；

   - 设置过期时间（例如 90 天，到期需重新创建并更新）。
5. **fine-grained 模式**：

   - **Repository access** 选 `Only select repositories` → 勾选你的这个签到仓库；

   - **Permissions → Repository permissions → Secrets** 设为 **Read and write**；

   - 过期时间建议不超过 90 天。
6. 点 **Generate token**，**立刻复制**生成的 token（只显示一次，关页面就没了）。
7. 回到仓库的 **Settings → Secrets and variables → Actions**，把这份 token 存为 `GH_PAT`。

> 安全提示：这份 PAT 相当于你账号的一把钥匙，**不要贴到任何聊天、文档或工作流文件里**，只放进 GitHub Secrets。GitHub 不会把 Secret 列到 Actions 日志（会自动打码）。

#### 首次运行说明

- 没配 `TUDOUAI_TOKEN`、只配了账号密码：脚本会自动登录（日志显示 `autoLogin`），**首次**会在日志里提示「未配置/跳过写回」，签到已正常完成；之后配置好 `GH_PAT` 就会自动写回，下次就复用 token 了。

- 配好全部 4 个后：进入 **Actions** → 选工作流 → 点 **Run workflow**（`workflow_dispatch`）手动跑一次验证，日志 `allOk: true` 即成功。

### 通知渠道（可选）

每次运行结束后，脚本会把签到结果（成功/失败、各步骤状态）发到你配置的渠道。**不配任何渠道就静默跳过**，不影响签到。渠道通过环境变量 / Secrets 启用，配哪个发哪个，支持同时启用多个。

| 渠道        | Secret 名称                                                         | 说明                                  |
| --------- | ----------------------------------------------------------------- | ----------------------------------- |
| 企业微信      | `WECOM_BOT_KEY`                                                   | 群机器人 Webhook 的 `key`                |
| 钉钉        | `DINGTALK_BOT_KEY`                                                | 机器人 `access_token`                  |
| <br />    | `DINGTALK_SECRET`                                                 | 加签时填（机器人安全设置里的加签密钥）                 |
| 飞书        | `FEISHU_BOT_KEY`                                                  | 自定义机器人 Webhook 地址尾部的 token          |
| 云湖        | `YUNHU_BOT_KEY`                                                   | 云湖机器人 Webhook key                   |
| Server酱   | `SERVERCHAN_SENDKEY`                                              | sct SendKey                         |
| PushPlus  | `PUSHPLUS_TOKEN`                                                  | PushPlus token                      |
| <br />    | `PUSHPLUS_TOPIC`                                                  | 可选，指定推送 `topic` 群组                  |
| Telegram  | `TG_BOT_TOKEN` / `TG_CHAT_ID`                                     | Bot Token + 接收 Chat ID              |
| Bark(iOS) | `BARK_KEY`                                                        | Bark 推送 key（或完整服务器地址）               |
| <br />    | `BARK_GROUP`                                                      | 可选，分组                               |
| Discord   | `DISCORD_WEBHOOK`                                                 | Webhook 完整 URL                      |
| 邮箱 SMTP   | `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_TO` | 用 465(隐式 TLS) 或 587/25(STARTTLS) 发送 |

配置方法同上面的 Secrets 步骤：`Settings → Secrets and variables → Actions → New repository secret`，把要用的渠道 Secret 逐个添加即可（无需的渠道留空）。

## 文件

- `sign.js`：主入口（复用/失效检测/自动登录/写回/重跑 + 三条签到链路）

- `src/config.js`：端点与常量、凭据读取（环境变量）

- `src/auth.js`：登录加密实现（AES+RSA，还原自前端 `auth` chunk）

- `src/mc-bank.js`：MC 答题题库（可增补）

- `.github/workflows/daily-sign.yml`：GitHub Actions 定时任务

详见 `SIGNUP_PLAN.md`。
