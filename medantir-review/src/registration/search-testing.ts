import type { ReviewRequest, SearchStrategy, SearchStrategyTestResult } from '../core/types.js';
import type { SearchStrategyTestingPort } from '../core/ports.js';

function balanced(query: string, open: string, close: string): boolean {
  let count = 0;
  for (const character of query) {
    if (character === open) count += 1;
    if (character === close) count -= 1;
    if (count < 0) return false;
  }
  return count === 0;
}

function conceptTerms(request: ReviewRequest): string[] {
  return [
    request.question.population,
    request.question.interventionOrExposure,
    request.question.comparator,
    ...(request.question.outcomes ?? []),
    ...(request.question.concepts ?? []).flatMap((c: any) => typeof c === 'string' ? [c] : [...(c.terms || []), ...(c.freeText || [])]),
  ].filter((term): term is string => typeof term === 'string' && Boolean(term.trim()));
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export class DeterministicSearchStrategyTester implements SearchStrategyTestingPort {
  async test(strategy: SearchStrategy, request: ReviewRequest): Promise<SearchStrategyTestResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const query = strategy.query.trim();
    if (!query) errors.push('Query is empty.');
    if (!balanced(query, '(', ')')) errors.push('Parentheses are unbalanced.');
    if ((query.match(/"/g)?.length ?? 0) % 2 !== 0) errors.push('Quotation marks are unbalanced.');
    if (/\bAND\s+AND\b|\bOR\s+OR\b|\bNOT\s+NOT\b/i.test(query)) errors.push('Repeated Boolean operator detected.');
    if (/\bAND\s*(?:\)|$)|\bOR\s*(?:\)|$)|\bNOT\s*(?:\)|$)/i.test(query)) errors.push('Dangling Boolean operator detected.');

    const database = strategy.database.toLowerCase();
    if (database === 'pubmed' && !/\[(?:title\/abstract|tiab|mesh terms|publication type)\]/i.test(query)) {
      warnings.push('No recognised PubMed field tag was detected.');
    }
    if ((database === 'medline' || database === 'embase') && !/\.(?:ti|ab|tw|kf|kw|mp)(?:,[a-z]+)*\./i.test(query)) {
      warnings.push('No recognised Ovid field suffix was detected.');
    }
    if (database === 'web of science' && !/\b(?:TS|TI|AB)=\(/i.test(query)) {
      warnings.push('No recognised Web of Science field prefix was detected.');
    }

    const queryNormalised = normalise(query);
    const terms = conceptTerms(request);
    const conceptsCovered = terms.filter((term) => {
      const words = normalise(term).split(' ').filter((word) => word.length >= 4);
      return words.length === 0 || words.some((word) => queryNormalised.includes(word));
    });
    const conceptsMissing = terms.filter((term) => !conceptsCovered.includes(term));
    if (conceptsMissing.length > 0) warnings.push(`Potential concept omissions: ${conceptsMissing.join('; ')}`);

    return {
      database: strategy.database,
      platform: strategy.platform,
      syntaxValid: errors.length === 0,
      conceptsCovered,
      conceptsMissing,
      warnings,
      errors,
      testedAt: new Date().toISOString(),
      testedQuery: strategy.query,
    };
  }
}
