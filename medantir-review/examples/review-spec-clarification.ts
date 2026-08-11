import { QuestionAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AutonomousQuestionAgent } from '../src/question/autonomous-question-agent.js';
import { recordClarificationResolution } from '../src/question/clarification-state.js';
import type { ClarificationIssue, ClarificationResolution } from '../src/question/review-spec.js';

const state = createPipelineState(fixtureRequest);
const agent = new AutonomousQuestionAgent(new QuestionAgent());

const first = await agent.execute({ state, now: () => new Date().toISOString() });
Object.assign(state.artifacts, first.artifacts);

if (first.awaitingHuman) {
  state.stages.question.status = 'awaiting-human';
  const request = state.artifacts.clarificationRequest as { issue: ClarificationIssue };
  console.log(JSON.stringify({
    status: 'needs-clarification',
    question: request.issue.question,
    field: request.issue.field,
    whyItMatters: request.issue.whyItMatters,
    impacts: request.issue.impacts,
  }, null, 2));

  if (request.issue.field === 'eligibleDesigns') {
    const resolution: ClarificationResolution = {
      issueId: request.issue.id,
      field: request.issue.field,
      value: ['randomised controlled trial'],
      rationale: 'Executable example chooses an RCT-only intervention review.',
      actorId: 'example:reviewer',
      decidedAt: new Date().toISOString(),
    };
    recordClarificationResolution(state, resolution);
    const resumed = await agent.execute({ state, now: () => new Date().toISOString() });
    console.log(JSON.stringify({
      status: (resumed.artifacts.reviewSpecCompilation as { status: string }).status,
      reviewSpecHash: (resumed.artifacts.reviewSpecCompilation as { reviewSpecHash: string }).reviewSpecHash,
      protocolAmendments: resumed.artifacts.protocolAmendments,
    }, null, 2));
  }
}
