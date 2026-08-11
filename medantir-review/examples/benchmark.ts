import {
  createBenchmarkProtocol,
  evaluateBenchmark,
  getBenchmarkCase,
} from '../src/benchmark/index.js';

const benchmark = getBenchmarkCase('synergy-screening-gold');
const protocol = createBenchmarkProtocol(benchmark, 'frozen-reproduction');
const screeningTarget = protocol.targets.find((target) => target.id === 'tiab-recall');
if (!screeningTarget) throw new Error('Screening target not configured');

const evaluation = evaluateBenchmark({
  benchmarkId: benchmark.id,
  mode: protocol.mode,
  targets: [screeningTarget],
  observations: [{
    targetId: screeningTarget.id,
    value: 0.98,
    evidence: ['fixture://screening-evaluation.json'],
  }],
  discrepancyEvidence: { withinTolerance: true, frozenSnapshot: true },
});

console.log(JSON.stringify({ benchmark, protocol, evaluation }, null, 2));
