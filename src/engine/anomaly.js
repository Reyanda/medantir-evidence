import { mean, std } from "./algorithms.js";

export const WEATHER_FEATURES = Object.freeze([
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_gusts_10m_max",
  "et0_fao_evapotranspiration",
]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value) => Number.isFinite(Number(value));

function quantile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function weatherFeatureRows(daily = {}) {
  return (daily.time || []).map((date, index) => ({
    date,
    values: WEATHER_FEATURES.map((feature) => Number(daily[feature]?.[index])),
  })).filter((row) => row.values.every(finite));
}

export function fitScaler(matrix) {
  if (!matrix.length) throw new Error("Cannot fit weather scaler without baseline rows.");
  const width = matrix[0].length;
  const means = Array.from({ length: width }, (_, column) => mean(matrix.map((row) => row[column])));
  const scales = Array.from({ length: width }, (_, column) => Math.max(std(matrix.map((row) => row[column])), 1e-6));
  return {
    means,
    scales,
    transform: (row) => row.map((value, column) => (value - means[column]) / scales[column]),
  };
}

function initialWeight(row, column, scale = 0.18) {
  return Math.sin((row + 1) * 12.9898 + (column + 1) * 78.233) * scale;
}

export function trainAutoencoder(matrix, { hidden = 2, epochs = 220, learningRate = 0.012 } = {}) {
  if (matrix.length < 3) throw new Error("Autoencoder requires at least three training rows.");
  const width = matrix[0].length;
  const latent = Math.max(1, Math.min(hidden, width - 1));
  const encoder = Array.from({ length: latent }, (_, h) => Array.from({ length: width }, (_, d) => initialWeight(h, d)));
  const decoder = Array.from({ length: width }, (_, d) => Array.from({ length: latent }, (_, h) => initialWeight(d + 11, h + 7)));
  const hiddenBias = new Array(latent).fill(0);
  const outputBias = new Array(width).fill(0);

  const forward = (input) => {
    const encoded = encoder.map((weights, h) => Math.tanh(weights.reduce((sum, weight, d) => sum + weight * input[d], hiddenBias[h])));
    const reconstructed = decoder.map((weights, d) => weights.reduce((sum, weight, h) => sum + weight * encoded[h], outputBias[d]));
    return { encoded, reconstructed };
  };

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const input of matrix) {
      const { encoded, reconstructed } = forward(input);
      const outputGradient = reconstructed.map((value, d) => (2 * (value - input[d])) / width);
      const hiddenGradient = encoded.map((value, h) => {
        const downstream = outputGradient.reduce((sum, gradient, d) => sum + gradient * decoder[d][h], 0);
        return downstream * (1 - value * value);
      });
      for (let d = 0; d < width; d += 1) {
        for (let h = 0; h < latent; h += 1) decoder[d][h] -= learningRate * outputGradient[d] * encoded[h];
        outputBias[d] -= learningRate * outputGradient[d];
      }
      for (let h = 0; h < latent; h += 1) {
        for (let d = 0; d < width; d += 1) encoder[h][d] -= learningRate * hiddenGradient[h] * input[d];
        hiddenBias[h] -= learningRate * hiddenGradient[h];
      }
    }
  }

  return {
    inputWidth: width,
    hiddenWidth: latent,
    reconstruct: (input) => forward(input).reconstructed,
  };
}

export function reconstructionError(input, reconstructed) {
  return mean(input.map((value, index) => (value - reconstructed[index]) ** 2));
}

export function forecastWeatherAnomalies(daily, { today = new Date().toISOString().slice(0, 10), minBaselineRows = 14 } = {}) {
  const rows = weatherFeatureRows(daily);
  const baselineRows = rows.filter((row) => row.date < today);
  const forecastRows = rows.filter((row) => row.date > today);
  if (baselineRows.length < minBaselineRows) throw new Error(`Weather anomaly model needs at least ${minBaselineRows} complete baseline days; received ${baselineRows.length}.`);
  if (!forecastRows.length) throw new Error("Weather feed contains no future forecast rows.");

  const scaler = fitScaler(baselineRows.map((row) => row.values));
  const training = baselineRows.map((row) => scaler.transform(row.values));
  const model = trainAutoencoder(training);
  const baselineErrors = training.map((row) => reconstructionError(row, model.reconstruct(row)));
  const threshold = Math.max(quantile(baselineErrors, 0.95), mean(baselineErrors) + 2 * std(baselineErrors), 1e-6);
  const forecasts = forecastRows.map((row) => {
    const normalized = scaler.transform(row.values);
    const error = reconstructionError(normalized, model.reconstruct(normalized));
    const ratio = error / threshold;
    const score = Math.round(clamp(ratio * 50, 0, 100));
    const deviations = WEATHER_FEATURES.map((feature, index) => ({ feature, z: Number(normalized[index].toFixed(2)) }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return { date: row.date, error: Number(error.toFixed(5)), thresholdRatio: Number(ratio.toFixed(3)), score, deviations };
  });

  return {
    method: "deterministic shallow autoencoder",
    baseline: { start: baselineRows[0].date, end: baselineRows.at(-1).date, rows: baselineRows.length },
    forecast: { start: forecastRows[0].date, end: forecastRows.at(-1).date, rows: forecastRows.length },
    threshold: Number(threshold.toFixed(5)),
    baselineError: { mean: Number(mean(baselineErrors).toFixed(5)), p95: Number(quantile(baselineErrors, 0.95).toFixed(5)) },
    features: WEATHER_FEATURES,
    forecasts,
    maxScore: Math.max(...forecasts.map((row) => row.score)),
  };
}
