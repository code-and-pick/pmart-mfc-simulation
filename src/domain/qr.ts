// QR 코드 모듈 계산(외부 라이브러리 없이 — npm 설치 권한 없음, 2026-11-16). 화면 스캔 판 전용.
// 범위: 바이트 모드, 오류 정정 M, 버전 1~6(바이트 106자까지 — 위치·카트·상품 코드는 13~14자). 버전 7+ 의 버전 정보 칸은 그리지 않는다.
// 알고리즘은 ISO/IEC 18004 그대로(Project Nayuki QR Code generator 의 구조를 따름). PDA 카메라(ML Kit)는 형식 제한 없이 읽는다.

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16];
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4];
const FORMAT_BITS_M = 0; // L=1, M=0, Q=3, H=2

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];
}

/** GF(2^8) 곱(원시 다항식 0x11D) */
function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = mul(root, 0x02);
  }
  return r;
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
}

/** 형식 정보 15비트(오류 정정 M, 마스크 mask) — BCH(15,5) + 0x5412 */
export function formatBits(mask: number): number {
  const data = (FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export interface QrMatrix {
  size: number;
  /** [y][x] true = 검정 */
  dark: boolean[][];
  version: number;
}

/** 값을 QR 로. 너무 길면(버전 6-M 바이트 106 초과) null */
export function qrEncode(text: string): QrMatrix | null {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 6; ver++) if (4 + 8 + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  if (ver > 6) return null;
  const cap = dataCodewords(ver);

  // 데이터 비트: 바이트 모드 0100, 글자 수 8비트, 본문, 끝 표시(최대 0000), 바이트 맞춤, 채움 0xEC 0x11
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // 블록 나눔·오류 정정·섞기
  const nBlocks = NUM_BLOCKS_M[ver];
  const eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => (i !== shortLen - eccLen || j >= nShort) && all.push(b[i]));

  const size = ver * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, d: boolean) => {
    dark[y][x] = d;
    fn[y][x] = true;
  };
  // 타이밍
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // 찾기 무늬(+ 분리 띠)
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  }
  // 정렬 무늬
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
  }
  // 형식 정보 자리 확보(값은 마스크를 고른 뒤)
  const drawFormat = (mask: number) => {
    const b = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6));
    set(8, 8, bit(b, 7));
    set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  // 데이터 지그재그 배치
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        if (!fn[y][x] && i < all.length * 8) {
          dark[y][x] = bit(all[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
  }

  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[m](x, y)) dark[y][x] = !dark[y][x];
  };
  // 마스크: 벌점(같은 색 연속·2×2 덩어리·검정 비율)이 가장 낮은 것. 어떤 마스크든 읽히지만 표준대로 고른다
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(dark, size);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
    applyMask(m); // 되돌림(XOR)
  }
  applyMask(best);
  drawFormat(best);
  return { size, dark, version: ver };
}

function penalty(d: boolean[][], n: number): number {
  let s = 0;
  for (let k = 0; k < 2; k++)
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const cur = k ? d[b][a] : d[a][b];
        const prev = k ? d[b - 1][a] : d[a][b - 1];
        if (cur === prev) {
          run++;
          if (run === 5) s += 3;
          else if (run > 5) s++;
        } else run = 1;
      }
    }
  let darkCount = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (d[y][x]) darkCount++;
      if (x < n - 1 && y < n - 1 && d[y][x] === d[y][x + 1] && d[y][x] === d[y + 1][x] && d[y][x] === d[y + 1][x + 1]) s += 3;
    }
  s += Math.floor(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) * 10;
  return s;
}
