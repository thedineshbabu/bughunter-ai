/**
 * Static metadata for BugHunter.AI LangGraph agents (order matches pipeline).
 * @see agent/graph/graph.py
 */

export const PIPELINE_AGENT_IDS = [
  'orchestrator',
  'explorer',
  'validator',
  'security',
  'reporter',
];

/** @typedef {{ id: string; name: string; icon: string; role: string; description: string; capabilities: string[]; tools: string[]; pipelinePosition: number; color: string }} AgentProfile */

/** @type {AgentProfile[]} */
export const AGENT_PROFILES = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    icon: 'psychology',
    role: 'Test Strategist',
    description:
      'Analyzes the target URL, credentials, and app memory to produce a JSON testing strategy. Parsed pages and focus areas are merged with memory-driven priorities so the Explorer visits the right URLs first and uses the plan in its prompts.',
    capabilities: [
      'Test planning',
      'Auth-aware strategy',
      'Memory-informed prioritization',
      'User instructions & focus areas',
    ],
    tools: ['LLM', 'App memory context', 'Progress events'],
    pipelinePosition: 1,
    color: '#6366f1',
  },
  {
    id: 'explorer',
    name: 'Explorer',
    icon: 'travel_explore',
    role: 'Browser Explorer',
    description:
      'Drives Playwright to navigate the app, handle logins (flows, memory replay, or smart LLM login), capture screenshots, and record console/network issues. Visits priority pages and discovers links to broaden coverage.',
    capabilities: [
      'Multi-page exploration',
      'Login flows & screenshots',
      'Console & network error capture',
      'App memory–driven page priority',
    ],
    tools: ['Playwright (BrowserTool)', 'LLM (navigation hints)', 'Screenshots'],
    pipelinePosition: 2,
    color: '#0ea5e9',
  },
  {
    id: 'validator',
    name: 'Validator',
    icon: 'fact_check',
    role: 'Functional QA Analyst',
    description:
      'Reviews explorer observations (observe / errors_detected steps) with an LLM to find functional, UI, and error bugs—404s, layout issues, failed requests, validation problems, and accessibility gaps.',
    capabilities: [
      'Screenshot & step analysis',
      'Bug triage by severity',
      'Live bug_found notifications',
    ],
    tools: ['LLM', 'Test step JSON'],
    pipelinePosition: 3,
    color: '#a855f7',
  },
  {
    id: 'security',
    name: 'Security',
    icon: 'security',
    role: 'Security Tester',
    description:
      'Runs active checks on the seed URL and pages the Explorer visited (capped): reflected XSS and SQLi probes on form inputs, plus regex scans for exposed secrets. One browser session per URL.',
    capabilities: ['XSS probes', 'SQLi probes', 'Secret pattern scan'],
    tools: ['Playwright (BrowserTool)', 'Payload & regex libraries'],
    pipelinePosition: 4,
    color: '#dc2626',
  },
  {
    id: 'reporter',
    name: 'Reporter',
    icon: 'article',
    role: 'Bug Report Author',
    description:
      'Turns raw findings into structured, developer-ready reports (title, steps, severity, type). Marks regressions when a bug fingerprint matches known issues in app memory.',
    capabilities: [
      'Structured bug reports',
      'Regression detection',
      'Severity & type normalization',
    ],
    tools: ['LLM', 'Fingerprinting (app memory)'],
    pipelinePosition: 5,
    color: '#16a34a',
  },
];

/** @param {string} id */
export function getAgentProfile(id) {
  return AGENT_PROFILES.find((a) => a.id === id) || null;
}
