// algorithms.js — Multi-algorithm statistical engine with uncertainty.
//
// Real, running client-side implementations (no training server, no mock). Each
// algorithm scores the SAME signal series and returns a point estimate WITH an
// uncertainty interval. The ensemble's disagreement across algorithms is the
// epistemic / model uncertainty the operator sees — the whole point of running
// several methods instead of trusting one.
//
// Lineage note: mirrors the offline MapIt Python stack (bayesian_var.py,
// causal_prediction.py, hybrid_engine.py) — same families, ported to run live.
//
//   • Bayesian      — Normal-Normal conjugate updating → posterior + credible interval
//   • Forecast      — Holt's linear exponential smoothing → forecast + prediction interval
//   • Logistic (DL) — logistic regression trained by gradient descent → escalation prob
//   • RL            — Thompson-sampling bandit over response actions under uncertainty
//   • Ensemble      — combines the above; spread = model uncertainty

const Z95 = 1.959964; // normal quantile for 95%

// --- basic stats ---------------------------------------------------------
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// --- 1. Bayesian Normal-Normal conjugate updating ------------------------
// Prior N(mu0, tau0^2); observations with known likelihood variance sigma^2.
// Returns posterior mean/variance and a 95% credible interval.
export function bayesianNormal(series, { priorMean = 50, priorVar = 400, obsVar = 200 } = {}) {
  let mu = priorMean;
  let tau2 = priorVar;
  for (const x of series) {
    const k = tau2 / (tau2 + obsVar); // Kalman-like gain
    mu = mu + k * (x - mu);
    tau2 = (1 - k) * tau2;
  }
  const sd = Math.sqrt(tau2);
  return {
    name: "Bayesian",
    estimate: Number(mu.toFixed(2)),
    lower: Number((mu - Z95 * sd).toFixed(2)),
    upper: Number((mu + Z95 * sd).toFixed(2)),
    sd: Number(sd.toFixed(3)),
  };
}

// --- 2. Holt's linear exponential smoothing (forecast) -------------------
// Level + trend smoothing; forecasts h steps ahead with a residual-based interval.
export function holtForecast(series, { alpha = 0.5, beta = 0.3, h = 1 } = {}) {
  if (series.length < 2) {
    const v = series[0] ?? 0;
    return { name: "Forecast", estimate: v, lower: v, upper: v, sd: 0, trend: 0 };
  }
  let level = series[0];
  let trend = series[1] - series[0];
  const errors = [];
  for (let i = 1; i < series.length; i++) {
    const pred = level + trend;
    errors.push(series[i] - pred);
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const fc = level + h * trend;
  const se = std(errors) * Math.sqrt(h);
  return {
    name: "Forecast",
    estimate: Number(fc.toFixed(2)),
    lower: Number((fc - Z95 * se).toFixed(2)),
    upper: Number((fc + Z95 * se).toFixed(2)),
    sd: Number(se.toFixed(3)),
    trend: Number(trend.toFixed(3)),
  };
}

// --- 3. Logistic regression (the "deep learning" family, 1-layer) --------
// Trained by batch gradient descent on (features -> label). Returns weights and a
// predictor. Real learning: run a few hundred epochs on the supplied examples.
export function trainLogistic(X, y, { epochs = 400, lr = 0.1, l2 = 1e-3 } = {}) {
  const n = X.length;
  const d = n ? X[0].length : 0;
  let w = new Array(d).fill(0);
  let b = 0;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  for (let e = 0; e < epochs && n; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, xj, j) => s + xj * w[j], b);
      const err = sig(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return {
    w,
    b,
    predict: (x) => sig(x.reduce((s, xj, j) => s + xj * w[j], b)),
  };
}

// Convenience: probability of escalation from current standardized features,
// using a model trained on the provided history (or a sensible prior weighting).
export function logisticRisk(features, model) {
  const p = model ? model.predict(features) : 1 / (1 + Math.exp(-(features.reduce((a, b) => a + b, 0))));
  return {
    name: "Logistic",
    estimate: Number((p * 100).toFixed(2)),
    lower: Number((clamp(p - 0.12, 0, 1) * 100).toFixed(2)),
    upper: Number((clamp(p + 0.12, 0, 1) * 100).toFixed(2)),
    sd: 12,
  };
}

// --- 3b. Neural network: autoregressive MLP forecaster -------------------
// A genuine 1-hidden-layer neural net (lags → tanh hidden → linear out) trained by
// SGD on the series' own sliding windows to predict the next value. Unlike the
// untrained logistic head, this learns from the data and stays on the 0..100 risk
// scale, so it tracks level AND shape. Falls back gracefully on short series.
export function mlpForecast(series, { lags = 3, hidden = 8, epochs = 350, lr = 0.05 } = {}) {
  const raw = series.length ? series : [0];
  const last = raw[raw.length - 1];
  if (raw.length < lags + 3) {
    return { name: "NeuralNet", estimate: Number(last.toFixed(2)), lower: Number((last - 10).toFixed(2)), upper: Number((last + 10).toFixed(2)), sd: 10 };
  }
  const s = raw.map((v) => v / 100); // normalise to [0,1]

  // training pairs: window of `lags` values → next value
  const X = [], Y = [];
  for (let i = lags; i < s.length; i++) { X.push(s.slice(i - lags, i)); Y.push(s[i]); }

  // small random init (Math.random is fine in app code, not in workflow scripts)
  const rnd = () => (Math.random() - 0.5) * 0.6;
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: lags }, rnd));
  const b1 = new Array(hidden).fill(0);
  const W2 = Array.from({ length: hidden }, rnd);
  let b2 = mean(Y);

  const forward = (x) => {
    const h = new Array(hidden);
    let y = b2;
    for (let j = 0; j < hidden; j++) {
      let z = b1[j];
      for (let k = 0; k < lags; k++) z += W1[j][k] * x[k];
      h[j] = Math.tanh(z);
      y += W2[j] * h[j];
    }
    return { y, h };
  };

  for (let e = 0; e < epochs; e++) {
    for (let n = 0; n < X.length; n++) {
      const { y, h } = forward(X[n]);
      const err = y - Y[n]; // dL/dy for MSE
      for (let j = 0; j < hidden; j++) {
        const gh = err * W2[j] * (1 - h[j] * h[j]); // through tanh
        W2[j] -= lr * err * h[j];
        for (let k = 0; k < lags; k++) W1[j][k] -= lr * gh * X[n][k];
        b1[j] -= lr * gh;
      }
      b2 -= lr * err;
    }
  }

  // residual std over training set → prediction interval
  const resid = X.map((x, n) => forward(x).y - Y[n]);
  const se = std(resid) * 100;
  const pred = clamp(forward(s.slice(s.length - lags)).y * 100, 0, 100);
  return {
    name: "NeuralNet",
    estimate: Number(pred.toFixed(2)),
    lower: Number(clamp(pred - Z95 * se, 0, 100).toFixed(2)),
    upper: Number(clamp(pred + Z95 * se, 0, 100).toFixed(2)),
    sd: Number(se.toFixed(3)),
  };
}

// --- 4. Reinforcement learning: Thompson-sampling bandit -----------------
// Each candidate response action is a Beta(α,β) arm over "did acting here pay off".
// sampleBeta draws a posterior sample; the arm with the highest draw is chosen —
// balancing exploration/exploitation under genuine uncertainty.
function sampleGamma(k) {
  // Marsaglia-Tsang for k >= 1; boost for k < 1.
  if (k < 1) return sampleGamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function sampleBeta(a, b) {
  const ga = sampleGamma(a);
  const gb = sampleGamma(b);
  return ga / (ga + gb);
}

export function thompsonSelect(arms) {
  // arms: [{ id, alpha, beta }]
  let best = null;
  let bestDraw = -1;
  const draws = arms.map((arm) => {
    const draw = sampleBeta(arm.alpha, arm.beta);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = arm.id;
    }
    return { id: arm.id, draw: Number(draw.toFixed(3)), mean: Number((arm.alpha / (arm.alpha + arm.beta)).toFixed(3)) };
  });
  return { name: "RL-Thompson", choice: best, draws };
}

// --- 5. Ensemble → model uncertainty -------------------------------------
// Runs the estimator family on a risk series and reports each result plus the
// cross-model spread. High spread = the algorithms disagree = high epistemic
// uncertainty → the operator should treat the point estimate with caution.
export function ensembleRisk(series, { features, logisticModel } = {}) {
  const s = series.length ? series : [0];
  const results = [
    bayesianNormal(s),
    holtForecast(s, { h: 1 }),
    mlpForecast(s), // neural-net autoregressor (replaced the untrained logistic head)
    // simple mean-reversion baseline as a 4th independent view
    (() => {
      const m = mean(s);
      const sd = std(s);
      return { name: "MeanRevert", estimate: Number(m.toFixed(2)), lower: Number((m - Z95 * sd).toFixed(2)), upper: Number((m + Z95 * sd).toFixed(2)), sd: Number(sd.toFixed(3)) };
    })(),
  ];
  const points = results.map((r) => r.estimate);
  const consensus = mean(points);
  const spread = std(points); // absolute disagreement in index points
  const norm = clamp(spread / 50, 0, 1); // normalized model uncertainty 0..1
  return {
    results,
    consensus: Number(consensus.toFixed(2)),
    spread: Number(spread.toFixed(2)),
    modelUncertainty: Number(norm.toFixed(3)),
    band: [Number((consensus - Z95 * spread).toFixed(2)), Number((consensus + Z95 * spread).toFixed(2))],
  };
}

// Standardized feature vector from a series: [level, momentum, volatility].
function defaultFeatures(s) {
  const m = mean(s) / 100;
  const momentum = s.length > 1 ? (s[s.length - 1] - s[0]) / 100 : 0;
  const vol = std(s) / 100;
  return [m, momentum, vol];
}

export { defaultFeatures };
