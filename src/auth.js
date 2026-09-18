// 登录：POST auth/pterodactylLogin，RuoYi-Plus 加密方案（已从前端 bundle 逆向确认）。
//  1) 生成 32 位随机串 asAES 密钥
//  2) encrypt-key 头 = RSA_PKCS1v1_5( RSA公钥, base64(asKey) )
//  3) body = AES-256-ECB-Pkcs7( json{username,password}, asKey ) 的 base64
//  4) 响应 body 也用同一 asKey 用 AES-256-ECB 解密 → JSON
//  clientid 为前端写死的常量（CLIENTID）。

import { randomBytes, createPublicKey, publicEncrypt, constants, createCipheriv, createDecipheriv } from 'node:crypto';
import { ENDPOINTS, creds, CLIENTID, RSA_PUBLIC_KEY_DER } from './config.js';

const AES_KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomAesKey() {
  // 用随机字节取模映射到字符集，避免 Math.random 可预测（等价前端 A()）
  const bytes = randomBytes(512);
  let key = '';
  for (let i = 0; i < 32; i++) key += AES_KEY_CHARS[bytes[i] % AES_KEY_CHARS.length];
  return key;
}

function rsaEncrypt(derB64, buf) {
  const pub = createPublicKey({ key: Buffer.from(derB64, 'base64'), format: 'der', type: 'spki' });
  return publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_PADDING }, buf).toString('base64');
}

// AES-256-ECB-Pkcs7，key 为 utf8 字节
function aesEncrypt(plain, key) {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null);
  return cipher.update(plain, 'utf8', 'base64') + cipher.final('base64');
}

function aesDecrypt(b64, key) {
  const decipher = createDecipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null);
  return decipher.update(b64, 'base64', 'utf8') + decipher.final('utf8');
}

async function logIn() {
  const { username, password } = creds();
  const aesKey = randomAesKey();
  const encryptedBody = aesEncrypt(JSON.stringify({ username, password }), aesKey);
  const encryptKey = rsaEncrypt(RSA_PUBLIC_KEY_DER, Buffer.from(Buffer.from(aesKey, 'utf8').toString('base64'), 'utf8'));

  const res = await fetch(ENDPOINTS.login, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'content-language': 'zh_CN',
      Origin: 'https://tudouai.cn',
      Referer: 'https://tudouai.cn/',
      clientid: CLIENTID,
      'encrypt-key': encryptKey,
      isencrypt: 'true',
      istoken: 'false',
      repeatsubmit: 'false',
    },
    body: encryptedBody,
  });

  const ciphertext = await res.text();
  // 响应同样用本会话 aesKey 加密，直接解。
  const plain = aesDecrypt(ciphertext, aesKey);
  let data;
  try {
    data = JSON.parse(plain);
  } catch {
    throw new Error(`登录解签失败（HTTP ${res.status}）：${ciphertext.slice(0, 120)}`);
  }
  const token = extractToken(data);
  if (!token) throw new Error(`登录未返回 token：${plain.slice(0, 300)}`);
  return { token, clientId: CLIENTID };
}

function extractToken(data) {
  return (
    data?.token ||
    data?.access_token ||
    data?.data?.token ||
    data?.data?.access_token ||
    (typeof data === 'string' ? data : null)
  );
}

export { logIn, extractToken };