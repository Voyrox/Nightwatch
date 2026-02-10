function nowSydneyHour(tsSeconds) {
  const d = new Date(tsSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: process.env.TZ || "Australia/Sydney",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h;
}

module.exports = { nowSydneyHour };
