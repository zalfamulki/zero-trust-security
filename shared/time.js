// Pemeriksaan jam akses (konteks waktu) dengan zona waktu eksplisit.

function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) throw new Error(`Format jam harus HH:MM, diterima "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Jam tidak valid: "${value}"`);
  return h * 60 + min;
}

function minutesInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

/**
 * true jika `date` berada pada [start, end) di zona waktu access.timezone.
 * start == end berarti jendela kosong (selalu di luar jam akses).
 * "24:00" diperbolehkan sebagai akhir hari.
 */
function withinAccessHours(date, access) {
  const now = minutesInZone(date, access.timezone);
  const start = parseHHMM(access.start);
  const end = parseHHMM(access.end);
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end; // jendela melewati tengah malam
}

module.exports = { withinAccessHours, parseHHMM, minutesInZone };
