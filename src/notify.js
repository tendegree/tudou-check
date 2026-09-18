/**
 * 多渠道通知模块（移植自 tendegree/wj-atuo，改为 ESM、去除 colorOut 依赖）
 * 通过环境变量 / GitHub Secrets 启用指定渠道，未配置的渠道自动跳过，无外部依赖。
 *
 *  1. 企业微信机器人   WECOM_BOT_KEY          (webhook key)
 *  2. 钉钉机器人       DINGTALK_BOT_KEY       (+ 可选 DINGTALK_SECRET)
 *  3. 飞书机器人       FEISHU_BOT_KEY         (webhook key)
 *  4. 云湖机器人       YUNHU_BOT_KEY          (webhook key)
 *  5. Server酱         SERVERCHAN_SENDKEY     (sendkey)
 *  6. PushPlus         PUSHPLUS_TOKEN         (+ 可选 PUSHPLUS_TOPIC)
 *  7. Telegram Bot     TG_BOT_TOKEN + TG_CHAT_ID
 *  8. Bark (iOS)       BARK_KEY               (+ 可选 BARK_GROUP)
 *  9. Discord Webhook  DISCORD_WEBHOOK        (完整 URL)
 * 10. 邮箱 SMTP        MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_TO
 */
import crypto from 'node:crypto';
import tls from 'node:tls';
import net from 'node:net';

const log = (fn, msg) => console[fn] ? console[fn](msg) : console.log(msg);

/* 各渠道发送实现 */
// 1. 企业微信机器人
async function sendWeCom(title, content, key) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: `${title}\n\n${content}` } }),
  });
  return resp.ok;
}
// 2. 钉钉机器人
async function sendDingTalk(title, content, key, secret) {
  let url = `https://oapi.dingtalk.com/robot/send?access_token=${key}`;
  if (secret) {
    const timestamp = Date.now();
    const sign = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}\n${secret}`)
      .digest('base64');
    url += `&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${content}` } }),
  });
  return resp.ok;
}
// 3. 飞书机器人
async function sendFeishu(title, content, key) {
  const url = `https://open.feishu.cn/open-apis/bot/v2/hook/${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text: `${title}\n\n${content}` } }),
  });
  return resp.ok;
}
// 4. 云湖机器人
async function sendYunhu(title, content, key) {
  const url = `https://www.yhchat.com/bot/send?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg: { text: `${title}\n\n${content}` } }),
  });
  return resp.ok;
}
// 5. Server酱
async function sendServerChan(title, content, sendkey) {
  const url = `https://sctapi.ftqq.com/${sendkey}.send`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp: content }),
  });
  return resp.ok;
}
// 6. PushPlus
async function sendPushPlus(title, content, token, topic) {
  const url = 'https://www.pushplus.plus/send';
  const body = { token, title, content, template: 'txt' };
  if (topic) body.topic = topic;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}
// 7. Telegram Bot
async function sendTelegram(title, content, botToken, chatId) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `*${title}*\n\n${content}`, parse_mode: 'Markdown' }),
  });
  return resp.ok;
}
// 8. Bark (iOS 推送)
async function sendBark(title, content, key, group) {
  const base = key.startsWith('http') ? key : `https://api.day.app/${key}`;
  const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`;
  const params = new URLSearchParams();
  if (group) params.set('group', group);
  const finalUrl = params.toString() ? `${url}?${params}` : url;
  const resp = await fetch(finalUrl);
  return resp.ok;
}
// 9. Discord Webhook
async function sendDiscord(title, content, webhookUrl) {
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `**${title}**\n\n${content}`.slice(0, 2000) }),
  });
  return resp.ok;
}
// 10. 邮箱 SMTP（node:net/node:tls 实现最小 SMTP 客户端，含刺杀 dot-stuffing）
async function sendMailSMTP(title, content, cfg) {
  const { host, port, user, pass, to } = cfg;
  const from = user;
  const subject = `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`;
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@tudouai-sign>`;
  // SMTP dot-stuffing：正文以 "." 开头的行须补一个点，否则被当作结束符提前截断
  const safeContent = String(content).replace(/^\./gm, '..');
  const mailBody = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    safeContent,
  ].join('\r\n');

  const smtpPort = Number(port) || 465;
  const useSTARTTLS = smtpPort !== 465;

  return new Promise((resolve, reject) => {
    // 隐式 TLS(465) 直接 TLS；STARTTLS(587/25) 先明文再升级
    let state = 'GREETING'; // GREETING→EHLO_SENT→[STARTTLS_SENT→TLS_UPGRADED→EHLO2_SENT]→AUTH
    let buffer = '';
    let socket;
    let timer;
    let completed = false;
    let settled = false;

    const authCommands = [
      'AUTH LOGIN',
      Buffer.from(user).toString('base64'),
      Buffer.from(pass).toString('base64'),
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      'DATA',
      mailBody.replace(/\r?\n/g, '\r\n') + '\r\n.',
      'QUIT',
    ];
    let authStep = 0;

    function finish(success, err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (success) resolve(true);
      else reject(err || new Error('SMTP 会话异常终止'));
    }
    function sendCmd(cmd) {
      socket.write(cmd + '\r\n');
    }
    function processData(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) {
        socket.destroy();
        finish(false, new Error(`SMTP 错误: ${line}`));
        return;
      }
      if (line[3] === '-') return; // 多行响应继续
      switch (state) {
        case 'GREETING':
          sendCmd('EHLO tudouai-sign');
          state = 'EHLO_SENT';
          break;
        case 'EHLO_SENT':
          if (useSTARTTLS) {
            sendCmd('STARTTLS');
            state = 'STARTTLS_SENT';
          } else {
            state = 'AUTH';
            authStep = 0;
            sendCmd(authCommands[authStep++]);
          }
          break;
        case 'STARTTLS_SENT':
          if (code !== 220) {
            socket.destroy();
            finish(false, new Error(`STARTTLS 失败: ${line}`));
            return;
          }
          socket = tls.connect({ socket, host, rejectUnauthorized: true });
          socket.setEncoding('utf8');
          socket.on('data', (chunk) => handleChunk(chunk));
          socket.on('end', () => finish(completed));
          socket.on('close', () => finish(completed));
          socket.on('error', (err) => finish(false, err));
          sendCmd('EHLO tudouai-sign');
          state = 'EHLO2_SENT';
          break;
        case 'EHLO2_SENT':
          state = 'AUTH';
          authStep = 0;
          sendCmd(authCommands[authStep++]);
          break;
        case 'AUTH':
          if (authStep < authCommands.length) {
            if (authCommands[authStep] === 'QUIT') completed = true;
            sendCmd(authCommands[authStep++]);
          } else if (code === 221) {
            completed = true;
          }
          break;
      }
    }
    function handleChunk(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processData(line);
      }
    }
    timer = setTimeout(() => {
      if (socket) socket.destroy();
      finish(false, new Error('SMTP 超时'));
    }, 15000);

    socket = useSTARTTLS
      ? net.connect(smtpPort, host, () => {})
      : tls.connect({ host, port: smtpPort, rejectUnauthorized: true }, () => {});
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => handleChunk(chunk));
    socket.on('end', () => finish(completed));
    socket.on('close', () => finish(completed));
    socket.on('error', (err) => finish(false, err));
  });
}

/* 统一发送入口 */
/**
 * 发送通知到所有已配置的渠道
 * @param {string} title   通知标题
 * @param {string} content 通知正文（纯文本）
 */
export async function sendNotify(title, content) {
  const channels = [];
  if (process.env.WECOM_BOT_KEY) {
    channels.push({ name: '企业微信', fn: () => sendWeCom(title, content, process.env.WECOM_BOT_KEY) });
  }
  if (process.env.DINGTALK_BOT_KEY) {
    channels.push({ name: '钉钉', fn: () => sendDingTalk(title, content, process.env.DINGTALK_BOT_KEY, process.env.DINGTALK_SECRET) });
  }
  if (process.env.FEISHU_BOT_KEY) {
    channels.push({ name: '飞书', fn: () => sendFeishu(title, content, process.env.FEISHU_BOT_KEY) });
  }
  if (process.env.YUNHU_BOT_KEY) {
    channels.push({ name: '云湖', fn: () => sendYunhu(title, content, process.env.YUNHU_BOT_KEY) });
  }
  if (process.env.SERVERCHAN_SENDKEY) {
    channels.push({ name: 'Server酱', fn: () => sendServerChan(title, content, process.env.SERVERCHAN_SENDKEY) });
  }
  if (process.env.PUSHPLUS_TOKEN) {
    channels.push({ name: 'PushPlus', fn: () => sendPushPlus(title, content, process.env.PUSHPLUS_TOKEN, process.env.PUSHPLUS_TOPIC) });
  }
  if (process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID) {
    channels.push({ name: 'Telegram', fn: () => sendTelegram(title, content, process.env.TG_BOT_TOKEN, process.env.TG_CHAT_ID) });
  }
  if (process.env.BARK_KEY) {
    channels.push({ name: 'Bark', fn: () => sendBark(title, content, process.env.BARK_KEY, process.env.BARK_GROUP) });
  }
  if (process.env.DISCORD_WEBHOOK) {
    channels.push({ name: 'Discord', fn: () => sendDiscord(title, content, process.env.DISCORD_WEBHOOK) });
  }
  if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS && process.env.MAIL_TO) {
    channels.push({
      name: '邮箱',
      fn: () => sendMailSMTP(title, content, {
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT || 465,
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
        to: process.env.MAIL_TO,
      }),
    });
  }
  if (channels.length === 0) {
    return; // 未配置任何渠道，静默跳过
  }
  log('log', `正在发送通知到 ${channels.length} 个渠道...`);
  const results = await Promise.allSettled(channels.map(async (ch) => ({ name: ch.name, ok: await ch.fn() })));
  let success = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      log('info', `  ✓ ${r.value.name} 发送成功`);
      success++;
    } else {
      const name = r.status === 'fulfilled' ? r.value.name : '未知';
      const reason = r.status === 'rejected' ? r.reason?.message : 'HTTP错误';
      log('warn', `  ✗ ${name} 发送失败: ${reason}`);
      fail++;
    }
  }
  log('info', `通知发送完成: ${success} 成功, ${fail} 失败`);
}