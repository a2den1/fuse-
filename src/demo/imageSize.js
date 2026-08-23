/*
 * 업로드된 이미지의 가로·세로를 헤더만 읽어 알아낸다.
 *
 * 실제 모드에서는 디스코드가 첨부의 width/height 를 내려주지만 데모에는 그게 없다.
 * 크기를 모르면 클라이언트가 비율을 미리 잡지 못해 이미지가 로드되는 순간 화면이 튄다.
 */

function png(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gif(buf) {
  if (buf.length < 10) return null;
  if (buf.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpeg(buf) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1];
    // SOF0~SOF15 중 DHT(c4)·JPG(c8)·DAC(cc) 를 뺀 것이 크기를 담고 있다
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webp(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);

  if (kind === 'VP8X') {
    return {
      width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  if (kind === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

const READERS = [png, gif, jpeg, webp];

/** @returns {{width:number, height:number}|null} */
export function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  for (const read of READERS) {
    try {
      const size = read(buffer);
      if (size?.width > 0 && size?.height > 0) return size;
    } catch {
      // 잘린 파일 — 다음 포맷으로 넘어간다
    }
  }
  return null;
}
