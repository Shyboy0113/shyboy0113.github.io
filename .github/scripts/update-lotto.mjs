// 동행복권에서 새 회차 당첨번호를 받아 lotto6_korea/draws.json에 추가합니다.
// GitHub Actions에서 실행: node .github/scripts/update-lotto.mjs
import { readFile, writeFile } from "node:fs/promises";

const HTML = "lotto6_korea/index.html";
const OUT = "lotto6_korea/draws.json";
const MAX_PER_RUN = 20;

// index.html에 고정된 RAW 데이터가 몇 회차까지인지 확인
const html = await readFile(HTML, "utf8");
const m = html.match(/const RAW="(\d+)"/);
if (!m) throw new Error("index.html에서 RAW 데이터를 찾지 못했어요.");
const baseLast = m[1].length / 14;

let data = [];
try { data = JSON.parse(await readFile(OUT, "utf8")); } catch { data = []; }
if (!Array.isArray(data)) data = [];
data = data.filter(d => d && d.r > baseLast).sort((a, b) => a.r - b.r);

// 빠진 회차 없이 이어진 부분만 유지
let next = baseLast + 1;
const kept = [];
for (const d of data) { if (d.r === next) { kept.push(d); next++; } else break; }
data = kept;
const before = JSON.stringify(data);

// 지금 시점에 추첨이 끝났어야 하는 마지막 회차 (토 20:35 KST 추첨, 여유 있게 21:00 기준)
const FIRST = Date.UTC(2002, 11, 7);
const WEEK = 7 * 864e5;
const expectedLatest = Math.floor((Date.now() - FIRST - 12 * 3600e3) / WEEK) + 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRound(r) {
  // 2026년 동행복권 사이트 개편으로 바뀐 엔드포인트. 요청한 회차 주변 10회차를 한 번에 돌려줍니다.
  const url = `https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=${r}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `https://www.dhlottery.co.kr/lt645/result?ltEpsd=${r}`,
        },
      });
      const text = await res.text();
      let j;
      try { j = JSON.parse(text); }
      catch { throw new Error(`JSON이 아닌 응답 (HTTP ${res.status}): ${text.slice(0, 150).replace(/\s+/g, " ")}`); }
      const row = (j && j.data && Array.isArray(j.data.list) ? j.data.list : []).find(x => +x.ltEpsd === r);
      if (!row) return null; // 아직 추첨 전
      const n = [1, 2, 3, 4, 5, 6].map(i => +row[`tm${i}WnNo`]).sort((a, b) => a - b);
      const b = +row.bnsWnNo;
      const all = [...n, b];
      if (all.some(x => !Number.isInteger(x) || x < 1 || x > 45) || new Set(all).size !== 7)
        throw new Error(`이상한 번호: ${JSON.stringify(row)}`);
      const ymd = String(row.ltRflYmd || "");
      const date = /^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}` : null;
      return { r, n, b, date };
    } catch (e) {
      lastErr = e;
      console.warn(`${r}회 시도 ${attempt} 실패: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

let error = null;
for (let i = 0; i < MAX_PER_RUN && next <= expectedLatest; i++) {
  try {
    const d = await fetchRound(next);
    if (!d) { console.log(`${next}회는 아직 결과가 없어요.`); break; }
    data.push(d);
    console.log(`${d.r}회 추가: ${d.n.join(", ")} + ${d.b}`);
    next++;
    await sleep(500);
  } catch (e) { error = e; break; }
}

if (JSON.stringify(data) !== before) {
  const body = "[\n" + data.map(d => "  " + JSON.stringify(d)).join(",\n") + "\n]\n";
  await writeFile(OUT, body);
  console.log(`${OUT} 저장 완료 (마지막 ${data.at(-1).r}회)`);
} else {
  console.log("새로 추가된 회차가 없어요.");
}

const latest = data.length ? data.at(-1).r : baseLast;
if (latest < expectedLatest) {
  console.error(`최신 회차는 ${expectedLatest}회인데 ${latest}회까지만 받았어요.` + (error ? ` 원인: ${error.message}` : ""));
  process.exitCode = 1; // 실패로 표시해서 GitHub가 알림을 보내도록
}
