// tudouai.cn 每日自动签到主入口（GitHub Actions runner）
// 用法：TUDOUAI_TOKEN=<JWT> node sign.js
//
// 已确认接口（请求体均为空，只需 Bearer JWT + clientid 头）：
//   - 社区签到  POST /client/forum/user/sign              → 已签到时 code 500 "今日已签到"
//   - 资源分享  POST /client/resource/task/daily-share    → 已分享时 code 500 "今日分享奖励已领取"
// 冷 IP 自动登录会触发图形验证码，故改用【手动提取的 TUDOUAI_TOKEN】(localStorage 的 Admin-Token) 直连。

import { ENDPOINTS, token, CLIENTID } from './src/config.js';
import { correctOption } from './src/mc-bank.js';

function safe(s) {
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

// 随机一个数组元素
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 答题签到（个人中心"每日签到"）：
// 1) generate 取题 → {uuid, question, options}
// 2) 提交 system/sign {useQaCaptcha:true, uuid, captchaAnswer}
//    答对 → code:200 签到成功；答错 → code:500 换题重试（上限 MAX_ATTEMPTS 次）。
//    优先用题库命中答案（correctOption），未命中则盲蒙一个选项。
const MAX_ATTEMPTS = 10;

async function quizSign(jwt) {
  const attempts = [];
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const g = await fetch(ENDPOINTS.qaGenerate, { headers: authHeaders(jwt) }).then((r) => r.json());
    const q = g?.data;
    if (!q) {
      return { ok: false, msg: `取题失败(第${i}次)：${g?.msg || g}` };
    }

    // 题库命中优先；否则盲蒙一个选项
    const banked = correctOption(q.question, q.options);
    const answer = banked || pickRandom(q.options);

    const res = await fetch(ENDPOINTS.signWithQa, {
      method: 'POST',
      headers: { ...authHeaders(jwt), 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ useQaCaptcha: true, uuid: q.uuid, captchaAnswer: answer }),
    });
    const v = await res.json();
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
async function emptyPost(url, jwt) {
  const res = await fetch(url, {
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
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { code: res.status, msg: text };
  }
  const msg = data?.msg || text;
  const alreadyDone = data?.code === 500 && /已/.test(msg);
  return { status: res.status, code: data?.code, msg: msg.slice(0, 60), alreadyDone };
}

async function run() {
  const steps = [];
  try {
    const jwt = token();
    steps.push({ step: 'loadToken', ok: true });

    for (const [name, url] of [
      ['communitySign', ENDPOINTS.communitySign],
      ['shareTask', ENDPOINTS.shareTask],
    ]) {
      const r = await emptyPost(url, jwt);
      // 已完成不代表本次失败；只有请求报错(非503已做之外的真实失败)才算 ok=false
      const ok = r.alreadyDone || r.status >= 200 && r.status < 400;
      steps.push({ step: name, ok, status: r.status, code: r.code, msg: r.msg, alreadyDone: r.alreadyDone });
    }

    // 答题签到（个人中心每日签到-答题档）
    steps.push({ step: 'quizSign', ...(await quizSign(jwt)) });
  } catch (e) {
    steps.push({ step: 'fatal', ok: false, msg: e.message });
  }

  const allOk = steps.every((s) => s.ok !== false);
  console.log(JSON.stringify({ allOk, steps }, null, 2));
  if (!allOk) process.exitCode = 1;
}

run();