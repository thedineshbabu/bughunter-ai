/** Styling for SSE live event types (shared by BugReports, AgentActivityLog). */
export const EVENT_CONFIG = {
  agent_start: { color: 'var(--secondary)', icon: 'play_circle' },
  agent_done: { color: '#16a34a', icon: 'check_circle' },
  page_visited: { color: 'var(--outline)', icon: 'travel_explore' },
  login_step: { color: '#f59e0b', icon: 'key' },
  bug_found: { color: 'var(--error)', icon: 'bug_report' },
  run_complete:  { color: '#16a34a', icon: 'verified' },
  run_failed:    { color: 'var(--error)', icon: 'error' },
  run_stopped:   { color: '#d97706', icon: 'stop_circle' },
  run_cancelled: { color: '#d97706', icon: 'stop_circle' },
  run_paused:    { color: '#7c3aed', icon: 'pause_circle' },
  run_resumed:   { color: 'var(--secondary)', icon: 'play_circle' },
};
