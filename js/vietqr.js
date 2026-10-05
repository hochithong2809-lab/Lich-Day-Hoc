/**
 * VietQR — bank-transfer QR codes (NAPAS 247 / EMVCo format) drawn as SVG.
 * Includes a small QR encoder (byte mode, error level M, versions 1–15), so no library is needed.
 * Any Vietnamese banking app can scan the result; amount and transfer note are filled in.
 */
var VietQR = (function () {
  'use strict';

  // ---------------- QR encoder ----------------
  // Error level M: [EC codewords per block, blocks in group 1, data cw per block g1, blocks g2, data cw g2]
  var EC_M = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
    [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var r = []; for (var i = 0; i < degree; i++) r.push(0);
    r[degree - 1] = 1;
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift(); res.push(0);
      for (var i = 0; i < div.length; i++) res[i] ^= gfMul(div[i], f);
    });
    return res;
  }
  function dataCapacity(v) { var e = EC_M[v]; return e[1] * e[2] + e[3] * e[4]; }

  function utf8(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), v;
    for (v = 1; v <= 15; v++) {
      var ccBits = v < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCapacity(v) * 8) break;
    }
    if (v > 15) throw new Error('QR text too long');
    var size = v * 4 + 17, cap = dataCapacity(v);

    // bit stream
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (var pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);

    // blocks + error correction, interleaved
    var e = EC_M[v], div = rsDivisor(e[0]), blocks = [], k = 0;
    for (i = 0; i < e[1] + e[3]; i++) {
      var len = i < e[1] ? e[2] : e[4];
      var d = data.slice(k, k + len); k += len;
      blocks.push({ d: d, ec: rsRemainder(d, div) });
    }
    var final = [], maxD = Math.max(e[2], e[4]);
    for (i = 0; i < maxD; i++) blocks.forEach(function (bl) { if (i < bl.d.length) final.push(bl.d[i]); });
    for (i = 0; i < e[0]; i++) blocks.forEach(function (bl) { final.push(bl.ec[i]); });

    // matrix
    var mod = [], fn = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    var al = ALIGN[v], n = al.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
        setF(al[i] + dx2, al[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
      }
    }
    function drawFormat(mask) {
      var dataBits = (0 << 3) | mask, rem = dataBits; // level M = 00
      for (var t = 0; t < 10; t++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var f = ((dataBits << 10) | rem) ^ 0x5412;
      var bit = function (q) { return ((f >>> q) & 1) !== 0; };
      for (var q = 0; q <= 5; q++) setF(8, q, bit(q));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (q = 9; q < 15; q++) setF(14 - q, 8, bit(q));
      for (q = 0; q < 8; q++) setF(size - 1 - q, 8, bit(q));
      for (q = 8; q < 15; q++) setF(8, size - 15 + q, bit(q));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (v >= 7) {
      var rem = v;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (v << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bitv = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bitv); setF(c, a, bitv);
      }
    }

    // place data
    var bi = 0, total = final.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < total) { mod[y][x] = ((final[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
        }
      }
    }

    // pick the mask with the lowest penalty
    function masked(m, x, y) {
      switch (m) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return x * y % 2 + x * y % 3 === 0;
        case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
        default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
    }
    function applyMask(m) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && masked(m, xx, yy)) mod[yy][xx] = !mod[yy][xx];
    }
    function penalty() {
      var p = 0, dark = 0, yy, xx;
      function line(get) {
        var run = 1, s = 0, str = '';
        for (var t = 0; t < size; t++) {
          var cur = get(t); str += cur ? '1' : '0';
          if (t > 0) { if (cur === get(t - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; }
        }
        var idx = -1;
        while ((idx = str.indexOf('1011101', idx + 1)) >= 0) {
          if (str.substr(idx - 4, 4) === '0000' || str.substr(idx + 7, 4) === '0000') s += 40;
        }
        return s;
      }
      for (yy = 0; yy < size; yy++) p += line(function (t) { return mod[yy][t]; });
      for (xx = 0; xx < size; xx++) p += line(function (t) { return mod[t][xx]; });
      for (yy = 0; yy < size - 1; yy++) for (xx = 0; xx < size - 1; xx++) {
        var c0 = mod[yy][xx];
        if (c0 === mod[yy][xx + 1] && c0 === mod[yy + 1][xx] && c0 === mod[yy + 1][xx + 1]) p += 3;
      }
      for (yy = 0; yy < size; yy++) for (xx = 0; xx < size; xx++) if (mod[yy][xx]) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    }
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size: size, modules: mod };
  }

  function svg(text, label) {
    var q = encode(text), s = q.size, quiet = 4, d = '';
    for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) if (q.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
    var full = s + quiet * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + ' ' + full + '" shape-rendering="crispEdges" role="img" aria-label="' + (label || 'QR') + '">' +
      '<rect width="' + full + '" height="' + full + '" fill="#ffffff"/><path d="' + d + '" fill="#000000"/></svg>';
  }

  // ---------------- VietQR payload ----------------
  function tlv(id, val) { val = String(val); return id + (val.length < 10 ? '0' : '') + val.length + val; }
  function crc16(s) {
    var c = 0xFFFF;
    for (var i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) { c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); c &= 0xFFFF; }
    }
    return ('000' + c.toString(16).toUpperCase()).slice(-4);
  }
  /** Bank apps only accept plain ASCII notes: strip Vietnamese accents and symbols. */
  function cleanNote(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, function (c) { return c === 'đ' ? 'd' : 'D'; })
      .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
  }
  /** bank: { bin: '970436', account: '1058674907' } */
  function payload(bank, amount, note) {
    var acct = tlv('00', 'A000000727') + tlv('01', tlv('00', bank.bin) + tlv('01', bank.account)) + tlv('02', 'QRIBFTTA');
    amount = Math.round(Number(amount) || 0);
    note = cleanNote(note);
    var s = tlv('00', '01') + tlv('01', amount > 0 ? '12' : '11') + tlv('38', acct) + tlv('53', '704') +
      (amount > 0 ? tlv('54', amount) : '') + tlv('58', 'VN') + (note ? tlv('62', tlv('08', note)) : '') + '6304';
    return s + crc16(s);
  }

  return { encode: encode, svg: svg, payload: payload, cleanNote: cleanNote, crc16: crc16 };
})();
