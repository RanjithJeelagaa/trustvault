import zlib from 'zlib';

function createCrcTable(): number[] {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

const crcTable = createCrcTable();

function crc32(buf: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * Generates a realistic invoice/receipt PNG image buffer (~2.5 KB).
 * Standard PNG magic bytes [89, 50, 4E, 47, 0D, 0A, 1A, 0A].
 */
export function generateReceiptPng(width = 400, height = 450): Buffer {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      // Outer card margin
      if (x < 16 || x >= width - 16 || y < 16 || y >= height - 16) {
        // Dark background (matches slate-900 / dark UI)
        rawData[px] = 15;
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
      } else if (y < 80) {
        // Header banner (Indigo gradient to emerald)
        rawData[px] = 79;
        rawData[px + 1] = 70;
        rawData[px + 2] = 229;
      } else if (y >= 80 && y < 86) {
        // Gold accent separator
        rawData[px] = 234;
        rawData[px + 1] = 179;
        rawData[px + 2] = 8;
      } else if (y >= height - 60) {
        // Footer section
        rawData[px] = 241;
        rawData[px + 1] = 245;
        rawData[px + 2] = 249;
      } else if (y % 45 >= 42) {
        // Item divider lines
        rawData[px] = 203;
        rawData[px + 1] = 213;
        rawData[px + 2] = 225;
      } else if (
        (x > 40 && x < 120 && y % 45 > 15 && y % 45 < 28) ||
        (x > 280 && x < 350 && y % 45 > 15 && y % 45 < 28)
      ) {
        // Simulated text blocks (dark slate bars representing item names and prices)
        rawData[px] = 51;
        rawData[px + 1] = 65;
        rawData[px + 2] = 85;
      } else {
        // Receipt paper white
        rawData[px] = 255;
        rawData[px + 1] = 255;
        rawData[px + 2] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Generates a realistic system architecture blueprint PNG image buffer (~3.4 KB).
 */
export function generateBlueprintPng(width = 500, height = 350): Buffer {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      const isGrid = x % 25 === 0 || y % 25 === 0;

      // Node 1: Client Gateway (x: 40-140, y: 130-220)
      const inNode1 = x >= 40 && x <= 140 && y >= 130 && y <= 220;
      const isNode1Border = inNode1 && (x <= 44 || x >= 136 || y <= 134 || y >= 216);

      // Node 2: TrustVault Core Server (x: 200-300, y: 100-250)
      const inNode2 = x >= 200 && x <= 300 && y >= 100 && y <= 250;
      const isNode2Border = inNode2 && (x <= 204 || x >= 296 || y <= 104 || y >= 246);

      // Node 3: Storage & DB Vault (x: 360-460, y: 130-220)
      const inNode3 = x >= 360 && x <= 460 && y >= 130 && y <= 220;
      const isNode3Border = inNode3 && (x <= 364 || x >= 456 || y <= 134 || y >= 216);

      // Connecting horizontal lines
      const inConnLine = y >= 173 && y <= 177 && ((x >= 140 && x <= 200) || (x >= 300 && x <= 360));

      if (isNode1Border || isNode2Border || isNode3Border || inConnLine) {
        rawData[px] = 56;
        rawData[px + 1] = 189;
        rawData[px + 2] = 248;
      } else if (inNode1 || inNode3) {
        rawData[px] = 15;
        rawData[px + 1] = 45;
        rawData[px + 2] = 95;
      } else if (inNode2) {
        rawData[px] = 30;
        rawData[px + 1] = 40;
        rawData[px + 2] = 110;
      } else if (isGrid) {
        rawData[px] = 14;
        rawData[px + 1] = 80;
        rawData[px + 2] = 135;
      } else {
        rawData[px] = 10;
        rawData[px + 1] = 40;
        rawData[px + 2] = 80;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

export const REALISTIC_RECEIPT_PNG = generateReceiptPng();
export const REALISTIC_BLUEPRINT_PNG = generateBlueprintPng();

export const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export const VALID_1X1_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
