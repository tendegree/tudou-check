// tudouai.cn 每日自动签到主入口（GitHub Actions runner）
// 凭据优先级：
//   1) 复用旧 TUDOUAI_TOKEN（JWT）→ 直接跑任务
//   2) 旧 JWT 失效/缺失 → 自动登录(TUDOUAI_USERNAME+TUDOUAI_PASSWORD) 换取新 JWT
//     并以 GH_PAT 写回 TUDOUAI_TOKEN secret，供下次复用
// 已确认接口（请求体均为空，只需 Bearer JWT + clientid 头）：
//   - 社区签到  POST /client/forum/user/sign              → 已签到时 code 500 "今日已签到"
//   - 资源分享  POST /client/resource/task/daily-share    → 已分享时 code 500 "今日分享奖励已领取"
// 登录走 RuoYi 网关 /auth/pterodactylLogin（AES+RSA 加密，body 含 datetime/grantType="pterodactyl"）。

import { execFileSync } from 'node:child_process';
import { ENDPOINTS, CLIENTID, listAccounts } from './src/config.js';
import { logIn } from './src/auth.js';
import { correctOption } from './src/mc-bank.js';
import { sendNotify } from './src/notify.js';
import { fetchRetry } from './src/net.js';

// 模拟真实用户操作间隔：每次网络动作之间随机停顿 5-8 秒，避免高频调用触发风控。
function sleepRandom() {
  const ms = Math.floor(5000 + Math.random() * 3000); // 5s ~ 8s
  return new Promise((r) => setTimeout(r, ms));
}

// 随机一个数组元素
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 判断是否因 token 无效/过期导致（匹配常见 RuoYi 风格响应）
function isUnauth(status, data, msg) {
  const code = data?.code;
  if (status === 401 || code === 401) return true;
  const s = String(msg || '');
  return /认证失败|登录状态已过期|未登录|重新登录|token|JWT/i.test(s) && /失|效|过期|错误|失败/i.test(s);
}

// 答题签到（个人中心"每日签到"）：
// 1) generate 取题 → {uuid, question, options}
// 2) 提交 system/sign {useQaCaptcha:true, uuid, captchaAnswer}
//    答对 → code:200 签到成功；答错 → code:500 换题重试（上限 MAX_ATTEMPTS 次）。
//    优先用题库命中答案（correctOption），未命中则盲蒙一个选项。
const MAX_ATTEMPTS = 10;

async function quizSign(jwt, label) {
  const attempts = [];
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    await sleepRandom(); // 人控间隔：取题前停顿
    const gr = await fetchRetry(ENDPOINTS.qaGenerate, { headers: authHeaders(jwt) }, { log: (m) => console.error(`[${label}][net] ${m}`) });
    const g = await gr.json();
    if (isUnauth(gr.status, g, g?.msg)) return { ok: false, tokenInvalid: true, attempts, msg: 'token 无效' };
    const q = g?.data;
    if (!q) {
      return { ok: false, attempts, msg: `取题失败(第${i}次)：${g?.msg || g}` };
    }

    // 题库命中优先；否则盲蒙一个选项
    const banked = correctOption(q.question, q.options);
    const answer = banked || pickRandom(q.options);

    await sleepRandom(); // 人控间隔：“思考作答”后再提交
    const res = await fetchRetry(ENDPOINTS.signWithQa, {
      method: 'POST',
      headers: { ...authHeaders(jwt), 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ useQaCaptcha: true, uuid: q.uuid, captchaAnswer: answer }),
    }, { log: (m) => console.error(`[${label}][net] ${m}`) });
    const v = await res.json();
    if (isUnauth(res.status, v, v?.msg)) return { ok: false, tokenInvalid: true, attempts, msg: 'token 无效' };
    const ok = v?.code === 200;
    attempts.push({ attempt: i, ok, banked: !!banked, answer: answer.slice(0, 20), code: v?.code, msg: (v?.msg || '').slice(0, 40) });

    if (ok) return { ok: true, attempts, msg: v?.msg };
  }
  // 10 次全蒙失败
  return { ok: false, attempts, msg: '盲蒙 10 次后仍未答对，签到未完成' };
}

function authHeaders(jwt) {
  return {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${jwt}`,
    clientid: CLIENTID,
    'content-language': 'zh_CN',
    Origin: 'https://tudouai.cn',
    Referer: 'https://tudouai.cn/',
  };
}

// 幂等：已完成(code 500 但 msg 含"已")视为成功，不报错；只有真正失败才 ok=false。
async function emptyPost(url, jwt, label) {
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      clientid: CLIENTID,
      'content-language': 'zh_CN',
      Origin: 'https://tudouai.cn',
      Referer: 'https://tudouai.cn/',
    },
    body: undefined, // 真实请求 body 为空（content-length: 0）
  }, { log: (m) => console.error(`[${label}][net] ${m}`) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { code: res.status, msg: text };
  }
  const msg = data?.msg || text;
  const alreadyDone = data?.code === 500 && /已/.test(msg);
  let ok = alreadyDone || (res.status >= 200 && res.status < 400);
  const tokenInvalid = isUnauth(res.status, data, msg);
  if (tokenInvalid) ok = false;
  return { status: res.status, code: data?.code, msg: msg.slice(0, 60), alreadyDone, tokenInvalid };
}

// 用给定 JWT 执行全部三个任务，返回 {steps, unauth}。label 为账号标识（用于日志区分多账号）。
async function execute(jwt, label) {
  const steps = [];
  for (const [name, url] of [
    ['communitySign', ENDPOINTS.communitySign],
    ['shareTask', ENDPOINTS.shareTask],
  ]) {
    await sleepRandom(); // 人控间隔：任务与任务之间停一下
    const r = await emptyPost(url, jwt, label);
    steps.push({ step: name, account: label, ok: r.ok, status: r.status, code: r.code, msg: r.msg, alreadyDone: r.alreadyDone, tokenInvalid: r.tokenInvalid });
  }
  const q = { step: 'quizSign', account: label, ...(await quizSign(jwt, label)) };
  steps.push(q);
  return { steps, unauth: steps.some((s) => s.tokenInvalid) };
}

// 用 GH_PAT 把新 JWT 写回仓库的指定 TOKEN secret（默认 TUDOUAI_TOKEN），供下次复用（幂等、不阻塞主流程）。
async function rotateSecret(jwt, secretName = 'TUDOUAI_TOKEN') {
  const repo = process.env.GITHUB_REPOSITORY;
  const pat = process.env.GH_PAT;
  if (!repo || !pat) {
    return { ok: true, msg: '跳过写回：未配置 GITHUB_REPOSITORY 或 GH_PAT（仅本地/未授权）' };
  }
  try {
    // 用 stdin 传 JWT，避免出现在命令行参数/进程列表中；stdio 全回收，不留痕。
    execFileSync('gh', ['secret', 'set', secretName, `--repo=${repo}`], {
      env: { ...process.env, GH_TOKEN: pat },
      input: jwt,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, msg: `已写回 ${secretName} secret` };
  } catch (e) {
    // 错误信息不包含 secret 明文；仅保留 gh 的前 120 字符用于诊断
    return { ok: false, msg: `写回失败: ${String(e.stderr || e.message || e).slice(0, 120)}` };
  }
}

async function run() {
  const steps = [];
  const push = (...oos) => steps.push(...oos);
  try {
    // 逐账号执行：每个账号独立完成【复用 token → 失效/缺失则自动登录 → 写回 secret → 重跑任务】
    const accounts = listAccounts();
    push({ step: 'accounts', ok: true, msg: `共 ${accounts.length} 个账号` });

    for (const acct of accounts) {
      await sleepRandom(); // 人控间隔：切换账号前停一下

      let jwt;
      if (acct.token) {
        jwt = acct.token;
        push({ step: 'reuseToken', account: acct.label, ok: true, len: jwt.length });
      } else {
        // 未配置 token 属初始状态，走自动登录即可，不判失败，避免误报（真实成败看任务步骤）。
        push({ step: 'reuseToken', account: acct.label, ok: true, msg: '未配置 TOKEN（将走自动登录）' });
      }

      let res = jwt ? await execute(jwt, acct.label) : { steps: [], unauth: true };

      // 旧 JWT 失效/缺失 → 自动登录换取新 JWT 并写回该账号的 secret
      if (res.unauth || !jwt) {
        // 这是预期恢复路径（自动登录并在重跑任务里体现真实成败），不视为失败。
        push({ step: 'tokenInvalid', account: acct.label, ok: true, msg: !jwt ? '无旧 JWT，改用自动登录' : '旧 JWT 已失效，改用自动登录' });
        await sleepRandom(); // 人控间隔：登录动作前停一下
        const a = await logIn({ username: acct.username, password: acct.password });
        jwt = a.token;
        push({ step: 'autoLogin', account: acct.label, ok: true, tokenLen: jwt.length });
        push({ step: 'rotateSecret', account: acct.label, ...(await rotateSecret(jwt, acct.tokenSecretName)) }); // 写回该账号 secret 供下次复用
        await sleepRandom(); // 人控间隔：登录完成后停一下再重跑
        res = await execute(jwt, acct.label); // 用新 JWT 重跑任务
      }

      push(...res.steps);
    }
  } catch (e) {
    push({ step: 'fatal', ok: false, msg: e.message });
  }

  const allOk = steps.every((s) => s.ok !== false);
  console.log(JSON.stringify({ allOk, steps }, null, 2));
  if (!allOk) process.exitCode = 1;

  // 多渠道通知（通过环境变量启用，未配置渠道自动跳过；正文不含任何敏感明文）
  try {
    const title = `${allOk ? '✅' : '⚠️'} 土豆AI 每日签到`;
    const lines = steps.map((s) => {
      const head = s.account ? `[${s.account}] ${s.step}` : s.step;
      const body = [head, s.ok === false ? '失败' : '成功', s.msg || '', s.code != null ? `code=${s.code}` : '', s.tokenInvalid ? 'tokenInvalid' : ''].filter(Boolean).join(' | ');
      return `- ${body}`;
    });
    await sendNotify(title, `时间: ${new Date().toLocaleString('zh-CN')}\n结果: ${allOk ? '全部成功' : '存在失败'}\n${lines.join('\n')}`);
  } catch (e) {
    console.error('通知发送异常(不影响签到结果):', e.message);
  }
}

run();