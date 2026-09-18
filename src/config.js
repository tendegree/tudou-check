// 配置：端点和凭据。凭据从环境变量读取（GitHub Actions Secrets），绝不硬编码。
// 请求基址可被 API_BASE 覆盖：GitHub runner 海外无法直接解析 api.td.tudouai.cn（ENOTFOUND），
// 部署一个 Cloudflare Worker 转发代理后，把 Worker 地址填进 API_BASE 即可（见 worker/index.js）。
export const API_BASE = process.env.API_BASE || 'https://api.td.tudouai.cn';

// clientid 是前端 bundle 里写死的常量（RuoYi-Plus 设备标识），登录/签到都必须带同一个。
export const CLIENTID = '3991ee92fe77fa9672e5eca721151dab';

// 登录 RSA 公钥（前端 bundle 内嵌，用于加密 AES 密钥生成 encrypt-key）。PKCS#1 // DER base64。
export const RSA_PUBLIC_KEY_DER =
  'MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAKoR8mX0rGKLqzcWmOzbfj64K8ZIgOdHnzkXSOVOZbFu/TJhZ7rFAN+eaGkl3C4buccQd/EjEsj9ir7ijT7h96MCAwEAAQ==';

export const ENDPOINTS = {
  login: `${API_BASE}/auth/pterodactylLogin`,
  // ✅ 已确认：社区签到。请求体为空，只需 Bearer JWT + clientid 头。
  //   MC 答题为纯前端门槛，无需传答案。已签到时返回 code 500 "今日已签到,请勿重复签到噢！"。
  communitySign: `${API_BASE}/client/forum/user/sign`,
  // ✅ 已确认：资源分享任务。请求体为空，只需 Bearer JWT + clientid 头。
  //   已完成时返回 code 500 "今日分享奖励已领取,明日再来吧！"。
  shareTask: `${API_BASE}/client/resource/task/daily-share`,
  // ✅ 已确认：答题签到（个人中心"每日签到"）。
  //   1) generate 取题 → 返回 {uuid, question, options}（不含答案）
  //   2) 提交【system/sign】body {useQaCaptcha:true, uuid, captchaAnswer} → 三合一校验+签到+发奖。
  //   答对 → code:200 "签到成功！获得土豆: 5"；答错 → code:500 "答题验证码错误或已过期，请重新答题"（可换题重试，上限10次）。
  qaGenerate: `${API_BASE}/resource/qa-captcha/generate?game=minecraft`,
  signWithQa: `${API_BASE}/system/sign`,
};

export function creds() {
  const username = process.env.TUDOUAI_USERNAME;
  const password = process.env.TUDOUAI_PASSWORD;
  if (!username || !password) {
    throw new Error('缺少 TUDOUAI_USERNAME / TUDOUAI_PASSWORD 环境变量');
  }
  return { username, password };
}

export function hasToken() {
  return !!process.env.TUDOUAI_TOKEN;
}

export function token() {
  const t = process.env.TUDOUAI_TOKEN;
  if (!t) {
    throw new Error('缺少 TUDOUAI_TOKEN 环境变量（登录后从 localStorage 的 Admin-Token 手动取出）');
  }
  return t;
}

// 把分号分隔的 JWT 串解析成数组（兼容中文/英文分隔符）。JWT 本身不含分号，可安全分隔。
export function parseTokenList(str) {
  if (!str) return [];
  return String(str)
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 多账号列表。
//  推荐（新格式，单 secret 收全部）
//    TUDOUAI_USER   = "账号1，密码1;账号2，密码2"   （账号/密码用逗号，账号之间用分号，中英文标点均可）
//    TUDOUAI_TOKEN  = "jwt1;jwt2"                  （分号分隔，与账号一一对应，可少填/留空走自动登录）
//  旧格式回退（兼容）
//    A. 单账号：TUDOUAI_USERNAME + TUDOUAI_PASSWORD (+ TUDOUAI_TOKEN)
//    B. 序号账号：TUDOUAI_ACCOUNT1_USERNAME / _PASSWORD / _TOKEN ...
// 返回 [{ username, password, token, label, tokenSecretName, groupToken }]
export function listAccounts() {
  const accounts = [];
  const userStr = process.env.TUDOUAI_USER;
  const tokenList = parseTokenList(process.env.TUDOUAI_TOKEN);

  if (userStr) {
    const pairs = String(userStr)
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    pairs.forEach((pair, i) => {
      const parts = pair.split(/[,，]/);
      accounts.push({
        label: `账号${i + 1}`,
        username: (parts[0] || '').trim(),
        password: (parts[1] || '').trim(),
        token: tokenList[i] || null,
        tokenSecretName: 'TUDOUAI_TOKEN',
        groupToken: true, // 自动登录后按序号重组整个分号串写回 TUDOUAI_TOKEN
      });
    });
  } else {
    // —— 旧格式回退 ——
    if (process.env.TUDOUAI_USERNAME) {
      accounts.push({
        label: '账号1',
        username: process.env.TUDOUAI_USERNAME,
        password: process.env.TUDOUAI_PASSWORD,
        token: process.env.TUDOUAI_TOKEN,
        tokenSecretName: 'TUDOUAI_TOKEN',
        groupToken: false,
      });
    }
    for (let n = 1; n < 50; n++) {
      const username = process.env[`TUDOUAI_ACCOUNT${n}_USERNAME`];
      if (!username) break;
      accounts.push({
        label: `账号${n + (process.env.TUDOUAI_USERNAME ? 1 : 0)}`,
        username,
        password: process.env[`TUDOUAI_ACCOUNT${n}_PASSWORD`],
        token: process.env[`TUDOUAI_ACCOUNT${n}_TOKEN`],
        tokenSecretName: `TUDOUAI_ACCOUNT${n}_TOKEN`,
        groupToken: false,
      });
    }
  }

  if (accounts.length === 0) {
    throw new Error('未配置任何账号：请设置 TUDOUAI_USER（账号,密码;账号,密码）或旧式 TUDOUAI_USERNAME(/PASSWORD)');
  }
  return accounts;
}