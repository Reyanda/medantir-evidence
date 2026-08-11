// plotSpecs.js — chart specifications for evidence-synthesis figures.
//
// Pure spec builders: they take a meta-analysis result (or PRISMA counts) and
// return an ECharts option object. No DOM, no rendering, no side effects — so the
// axis maths, the log scaling and the CI geometry are all unit-testable, which
// matters because a forest plot that mis-scales its confidence intervals is
// wrong in a way that looks perfectly plausible.

const NULL_LINE = { RR: 1, OR: 1, HR: 1, MD: 0, SMD: 0 };

/** The value where "no effect" sits: 1 for ratio measures, 0 for differences. */
export const nullValue = (measure) => NULL_LINE[measure] ?? 0;

const round = (value, dp = 3) => Number(Number(value).toFixed(dp));

/** Forest plot: one row per study plus the pooled diamond.
 *
 *  Ratio measures are plotted on a log axis — on a linear axis a halving and a
 *  doubling look like different magnitudes, which misrepresents the evidence. */
export function forestSpec(meta, { model = "random", title = "" } = {}) {
  if (!meta?.ok) return null;
  const chosen = meta[model] || meta.random;
  const studies = chosen.studies || [];
  const measure = meta.measure;
  const log = !!meta.log;

  const rows = [...studies].reverse();
  const names = [...rows.map((study) => study.name || "(unnamed)"), `Pooled (${model})`];

  // Whiskers are drawn as a custom series so each interval is an explicit
  // low→high span rather than a symmetric error bar, which ratio CIs are not.
  const intervals = rows.map((study, index) => [index, study.ci[0], study.ci[1]]);
  const points = rows.map((study, index) => [study.effect, index]);
  const pooledIndex = rows.length;

  const all = [...rows.flatMap((study) => study.ci), ...chosen.ci].filter((value) => Number.isFinite(value) && (!log || value > 0));
  const min = Math.min(...all, nullValue(measure));
  const max = Math.max(...all, nullValue(measure));

  return {
    title: title ? { text: title, left: "center", textStyle: { fontSize: 12 } } : undefined,
    grid: { left: 140, right: 60, top: title ? 34 : 10, bottom: 30 },
    xAxis: {
      type: log ? "log" : "value",
      min: log ? Math.max(min * 0.7, 1e-4) : min - Math.abs(max - min) * 0.15,
      max: log ? max * 1.4 : max + Math.abs(max - min) * 0.15,
      name: measure,
      nameLocation: "middle",
      nameGap: 22,
    },
    yAxis: { type: "category", data: names, axisTick: { show: false } },
    series: [
      {
        type: "custom", name: "CI",
        renderItem: (params, api) => {
          const index = api.value(0);
          const low = api.coord([api.value(1), index]);
          const high = api.coord([api.value(2), index]);
          return {
            type: "group",
            children: [
              { type: "line", shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style: api.style({ stroke: api.visual("color"), lineWidth: 1.5 }) },
              { type: "line", shape: { x1: low[0], y1: low[1] - 4, x2: low[0], y2: low[1] + 4 }, style: api.style({ stroke: api.visual("color"), lineWidth: 1.5 }) },
              { type: "line", shape: { x1: high[0], y1: high[1] - 4, x2: high[0], y2: high[1] + 4 }, style: api.style({ stroke: api.visual("color"), lineWidth: 1.5 }) },
            ],
          };
        },
        encode: { x: [1, 2], y: 0 },
        data: intervals,
      },
      {
        type: "scatter", name: "Effect",
        // Marker area encodes study weight, which is the convention readers expect.
        symbolSize: (value, params) => 6 + (rows[params.dataIndex]?.weight || 0) * 0.6,
        data: points,
      },
      {
        type: "scatter", name: "Pooled", symbol: "diamond", symbolSize: 16,
        data: [[chosen.effect, pooledIndex]],
      },
    ],
    markLineValue: nullValue(measure),
    _rows: names,
  };
}

/** Funnel plot: effect against precision, for small-study effects.
 *
 *  Standard error runs DOWNWARD on the y-axis (inverted) so the most precise
 *  studies sit at the top — plotting it the other way up inverts the funnel and
 *  reverses how asymmetry reads. */
export function funnelSpec(meta, { title = "" } = {}) {
  if (!meta?.ok) return null;
  const studies = meta.random?.studies || [];
  const centre = meta.random?.effect;

  return {
    title: title ? { text: title, left: "center", textStyle: { fontSize: 12 } } : undefined,
    grid: { left: 56, right: 20, top: title ? 34 : 12, bottom: 34 },
    xAxis: { type: meta.log ? "log" : "value", name: meta.measure, nameLocation: "middle", nameGap: 22 },
    yAxis: { type: "value", name: "SE", inverse: true, nameLocation: "middle", nameGap: 38 },
    series: [{
      type: "scatter", symbolSize: 8,
      data: studies.map((study) => [study.effect, round(study.se, 4), study.name]),
    }],
    markLineValue: centre,
  };
}

/** PRISMA 2020 flow as a labelled column. Counts come straight from the review's
 *  report stage, so the figure cannot drift from the numbers in the manuscript. */
export function prismaFlowSpec(counts = {}) {
  const stages = [
    { label: "Records identified", value: counts.identified ?? 0 },
    { label: "Duplicates removed", value: counts.duplicatesRemoved ?? 0 },
    { label: "Records screened", value: counts.screened ?? 0 },
    { label: "Excluded at title/abstract", value: counts.excluded ?? 0 },
    { label: "Full texts assessed", value: counts.fullTextScreened ?? 0 },
    { label: "Full texts excluded", value: counts.fullTextExcluded ?? 0 },
    { label: "Studies included", value: counts.included ?? 0 },
  ];
  return {
    grid: { left: 160, right: 30, top: 10, bottom: 24 },
    xAxis: { type: "value", name: "records", nameLocation: "middle", nameGap: 20 },
    yAxis: { type: "category", data: stages.map((stage) => stage.label).reverse(), axisTick: { show: false } },
    series: [{
      type: "bar", barWidth: "58%",
      label: { show: true, position: "right", fontSize: 10 },
      data: stages.map((stage) => stage.value).reverse(),
    }],
    _stages: stages,
  };
}

/** The R script that reproduces the same figures at publication quality.
 *
 *  Written into the project so the operator can run, edit and version it — the
 *  interactive chart is for exploration, this is what goes in the manuscript. */
export function forestRScript(meta, { model = "random" } = {}) {
  if (!meta?.ok) return "";
  const chosen = meta[model] || meta.random;
  const studies = chosen.studies || [];
  const het = meta.heterogeneity || {};

  return `# Generated by Actiora from the review's meta-analysis.
# Reproduces the interactive forest plot at publication quality.
#
# Uses the 'meta' package when it is installed, and falls back to base R
# otherwise — a figure script that dies on a missing CRAN package is no use on a
# machine that has not been set up yet, and the fallback needs no dependencies.

studies <- data.frame(
  study = c(${studies.map((s) => JSON.stringify(s.name || "")).join(", ")}),
  TE    = c(${studies.map((s) => s.raw).join(", ")}),
  seTE  = c(${studies.map((s) => s.se).join(", ")}),
  stringsAsFactors = FALSE
)

measure   <- ${JSON.stringify(meta.measure)}
log_scale <- ${meta.log ? "TRUE" : "FALSE"}
null_line <- if (log_scale) 1 else 0

dir.create("outputs/figures", recursive = TRUE, showWarnings = FALSE)

if (requireNamespace("meta", quietly = TRUE)) {
  library(meta)
  m <- metagen(
    TE = studies$TE, seTE = studies$seTE, studlab = studies$study,
    sm = measure, common = TRUE, random = TRUE, method.tau = "DL"
  )

  pdf("outputs/figures/forest.pdf", width = 9, height = ${Math.max(3, studies.length * 0.4 + 2)})
  forest(m, leftlabs = c("Study", "TE", "seTE"), print.I2 = TRUE, print.tau2 = TRUE)
  dev.off()

  pdf("outputs/figures/funnel.pdf", width = 6, height = 6)
  funnel(m)
  dev.off()

  # Egger's test needs k >= 10 before it is interpretable.
  if (m$k >= 10) print(metabias(m, method.bias = "linreg"))
  cat("Wrote outputs/figures/forest.pdf and funnel.pdf using the 'meta' package\\n")
} else {
  message("Package 'meta' is not installed — drawing with base R instead.")
  message("For the full publication figure: install.packages(\\"meta\\")")

  # Inverse-variance random effects, DerSimonian-Laird, computed in base R so the
  # fallback reports the same pooled estimate rather than a different one.
  w      <- 1 / studies$seTE^2
  fixed  <- sum(w * studies$TE) / sum(w)
  Q      <- sum(w * (studies$TE - fixed)^2)
  df     <- nrow(studies) - 1
  C      <- sum(w) - sum(w^2) / sum(w)
  tau2   <- max(0, if (C > 0) (Q - df) / C else 0)
  wr     <- 1 / (studies$seTE^2 + tau2)
  pooled <- sum(wr * studies$TE) / sum(wr)
  se_p   <- sqrt(1 / sum(wr))
  I2     <- if (Q > df && Q > 0) max(0, (Q - df) / Q * 100) else 0

  bt  <- function(v) if (log_scale) exp(v) else v
  lo  <- studies$TE - 1.96 * studies$seTE
  hi  <- studies$TE + 1.96 * studies$seTE
  est <- bt(c(studies$TE, pooled))
  lcl <- bt(c(lo, pooled - 1.96 * se_p))
  ucl <- bt(c(hi, pooled + 1.96 * se_p))
  lab <- c(studies$study, "Pooled (random)")
  n   <- length(lab)

  pdf("outputs/figures/forest.pdf", width = 9, height = ${Math.max(3, studies.length * 0.4 + 2)})
  op <- par(mar = c(5, 12, 3, 2))
  xlim <- range(c(lcl, ucl, null_line))
  plot(NA, xlim = xlim, ylim = c(0.5, n + 0.5), yaxt = "n", ylab = "",
       xlab = measure, log = if (log_scale) "x" else "",
       main = sprintf("Random-effects meta-analysis (I2 = %.0f%%)", I2))
  axis(2, at = n:1, labels = lab, las = 1, cex.axis = 0.8)
  abline(v = null_line, lty = 2, col = "grey40")
  for (i in seq_len(n)) {
    y <- n - i + 1
    if (i < n) {
      segments(lcl[i], y, ucl[i], y)
      # Marker area encodes the study's weight, as readers expect.
      points(est[i], y, pch = 15, cex = 0.6 + 2 * wr[i] / sum(wr))
    } else {
      # By convention the pooled estimate is a diamond whose WIDTH is its
      # confidence interval — a fixed-size marker hides the pooled precision.
      polygon(c(lcl[i], est[i], ucl[i], est[i]), c(y, y + 0.28, y, y - 0.28), col = "black")
    }
  }
  par(op)
  dev.off()

  pdf("outputs/figures/funnel.pdf", width = 6, height = 6)
  # SE increases DOWNWARD so the most precise studies sit at the top.
  plot(bt(studies$TE), studies$seTE, ylim = rev(range(studies$seTE)),
       xlab = measure, ylab = "Standard error", pch = 19,
       log = if (log_scale) "x" else "", main = "Funnel plot")
  abline(v = bt(pooled), lty = 2, col = "grey40")
  dev.off()

  cat(sprintf("Pooled %s = %.3f [%.3f, %.3f], I2 = %.0f%%, tau2 = %.4f\\n",
              measure, bt(pooled), bt(pooled - 1.96 * se_p), bt(pooled + 1.96 * se_p), I2, tau2))
  cat("Wrote outputs/figures/forest.pdf and funnel.pdf using base R\\n")
}
`;
}
