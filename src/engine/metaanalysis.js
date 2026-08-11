// metaanalysis.js — Real meta-analysis: inverse-variance fixed-effect and
// DerSimonian-Laird random-effects pooling, with Cochran's Q, I², tau², pooled
// effect + 95% CI, and forest/funnel plot data. No shortcuts — this is the
// un-fakeable statistical core of the SR pipeline.

const Z = 1.959964;
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Binary outcome → log risk ratio (or odds ratio) + standard error.
// study: { events_t, n_t, events_c, n_c }. Haldane-Anscombe 0.5 correction on zeros.
export function effectFromBinary(s, measure = "RR") {
  let { events_t: a, n_t, events_c: c, n_c } = s;
  const b = n_t - a, d = n_c - c;
  let A = a, B = b, C = c, D = d;
  if (A === 0 || B === 0 || C === 0 || D === 0) { A += 0.5; B += 0.5; C += 0.5; D += 0.5; }
  if (measure === "OR") {
    const logOR = Math.log((A * D) / (B * C));
    const se = Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D);
    return { effect: logOR, se, log: true };
  }
  const rt = A / (A + B), rc = C / (C + D);
  const logRR = Math.log(rt / rc);
  const se = Math.sqrt(1 / A - 1 / (A + B) + 1 / C - 1 / (C + D));
  return { effect: logRR, se, log: true };
}

// studies: [{ name, effect, se }] (effect on the analysis scale; log for RR/OR).
// measure: "RR" | "OR" | "MD" | "SMD" (controls back-transform + labels).
export function metaAnalyze(studies, { measure = "RR" } = {}) {
  const s = studies.filter((x) => Number.isFinite(x.effect) && Number.isFinite(x.se) && x.se > 0);
  const k = s.length;
  if (k === 0) return { ok: false, error: "no valid studies" };
  const log = measure === "RR" || measure === "OR";

  // fixed effect (inverse variance)
  const w = s.map((x) => 1 / (x.se * x.se));
  const sumW = w.reduce((a, b) => a + b, 0);
  const fixed = s.reduce((acc, x, i) => acc + w[i] * x.effect, 0) / sumW;
  const seFixed = Math.sqrt(1 / sumW);

  // heterogeneity: Cochran's Q, I², tau² (DerSimonian-Laird)
  const Q = s.reduce((acc, x, i) => acc + w[i] * (x.effect - fixed) ** 2, 0);
  const df = k - 1;
  const C = sumW - w.reduce((a, b) => a + b * b, 0) / sumW;
  const tau2 = Math.max(0, C > 0 ? (Q - df) / C : 0);
  const I2 = Q > df && Q > 0 ? Math.max(0, ((Q - df) / Q) * 100) : 0;

  // random effects
  const wr = s.map((x) => 1 / (x.se * x.se + tau2));
  const sumWr = wr.reduce((a, b) => a + b, 0);
  const random = s.reduce((acc, x, i) => acc + wr[i] * x.effect, 0) / sumWr;
  const seRandom = Math.sqrt(1 / sumWr);

  const bt = (v) => (log ? Math.exp(v) : v); // back-transform log RR/OR
  const model = (pt, se, weights, sumWt) => ({
    effect: Number(bt(pt).toFixed(3)),
    ci: [Number(bt(pt - Z * se).toFixed(3)), Number(bt(pt + Z * se).toFixed(3))],
    raw: pt, se, z: pt / se, p: 2 * (1 - normCdf(Math.abs(pt / se))),
    studies: s.map((x, i) => ({
      name: x.name, effect: Number(bt(x.effect).toFixed(3)),
      ci: [Number(bt(x.effect - Z * x.se).toFixed(3)), Number(bt(x.effect + Z * x.se).toFixed(3))],
      weight: Number(((weights[i] / sumWt) * 100).toFixed(1)),
      se: x.se, raw: x.effect,
    })),
  });

  return {
    ok: true, k, measure, log,
    fixed: model(fixed, seFixed, w, sumW),
    random: model(random, seRandom, wr, sumWr),
    heterogeneity: { Q: Number(Q.toFixed(2)), df, I2: Number(I2.toFixed(1)), tau2: Number(tau2.toFixed(4)),
      pQ: Number((1 - chi2Cdf(Q, df)).toFixed(4)),
      interpretation: I2 < 25 ? "low" : I2 < 50 ? "moderate" : I2 < 75 ? "substantial" : "considerable" },
    nullLine: log ? 1 : 0,
  };
}

// --- distributions (approximations, adequate for reporting) --------------
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function chi2Cdf(x, k) {
  if (x <= 0) return 0;
  // Wilson-Hilferty normal approximation to chi-square CDF
  const z = (Math.cbrt(x / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return normCdf(z);
}
