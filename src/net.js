// 网络请求封装：对网络层异常（Node fetch 在连接失败时抛 "fetch failed"）做指数退避重试。
// 背景：GitHub runner 上 Node20 fetch 默认优先解析 IPv6，若目标域名无 IPv6 或不通，即使
// IPv4 可用也会直接抛 "fetch failed"。方案已在 workfish 强制 NODE_OPTIONS 走 IPv4 优先，
// 此处重试再兜底偶发的网络抖动（限网络层失败，HTTP 响应层错误不在此重试）。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 重试策略：最多 attempts 次，第 i 次失败后等 baseMs * 2^(i-1) 再试，仍失败则抛最后一次错误。
export async function fetchRetry(url, opts = {}, { attempts = 3, baseMs = 1500, log } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        const wait = baseMs * 2 ** (i - 1);
        if (log) log(`请求失败(第 ${i} 次，${wait}ms 后重试): ${e.cause?.code || e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}