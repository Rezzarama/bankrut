export function genCoreRefId() {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // yyyymmdd
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `CORE-ACC-${ts}-${rand}`;
}
