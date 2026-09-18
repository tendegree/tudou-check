// 土豆签到 API 转发代理（Cloudflare Worker）
// 用途：GitHub Actions runner 在海外无法直接解析 api.td.tudouai.cn 域名（ENOTFOUND）。
// 部署此 Worker 到 Cloudflare，把请求原样转发给 api.td.tudouai.cn，再在仓库 Secrets 里把
// API_BASE 设为这个 Worker 的地址，脚本即可通过它完成签到。
//
// 部署（Cloudflare Dashboard，无需 CLI）：
//   1) Workers & Pages → 创建 → 创建 Worker → 名称自定（如 tudou-proxy）
//   2) 粘贴本文件内容 → 保存并部署
//   3) 在 https://<worker>.workers.<region>.workers.dev 上得到一个地址（或绑定你自己的域名）
//   4) 把该地址作为仓库 Secret `API_BASE`（示例 https://tudou-proxy.<sub>.workers.dev）
//
// 转发安全：客户端发来的 Authorization (Bearer JWT)、clientid、encrypt-key 等头原样透传；
// Worker 只做透明代理，不落盘/不打印任何 token，JWT 不会在 Worker 侧泄露。

const ORIGIN = 'https://api.td.tudouai.cn';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = ORIGIN + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.delete('host'); // 让 fetch 自行设置 api.td.tudouai.cn 的 Host
    headers.delete('cf-connecting-ip');
    headers.delete('x-forwarded-for');
    headers.delete('x-real-ip');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
    if (body) init.body = body;

    const resp = await fetch(target, init);
    const outHeaders = new Headers(resp.headers);
    outHeaders.delete('content-encoding');
    outHeaders.delete('transfer-encoding');
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: outHeaders,
    });
  },
};