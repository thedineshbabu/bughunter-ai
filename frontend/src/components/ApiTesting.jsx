import React, { useRef, useState } from 'react';
import api from '../services/api.js';

const METHOD_COLORS = {
  GET:    { bg: '#dbeafe', color: '#1e40af' },
  POST:   { bg: '#dcfce7', color: '#166534' },
  PUT:    { bg: '#fef9c3', color: '#854d0e' },
  PATCH:  { bg: '#fef3c7', color: '#92400e' },
  DELETE: { bg: '#fee2e2', color: '#991b1b' },
};

function MethodBadge({ method }) {
  const cfg = METHOD_COLORS[method] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, fontFamily: 'monospace', background: cfg.bg, color: cfg.color, flexShrink: 0 }}>
      {method}
    </span>
  );
}

function EndpointRow({ ep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--surface-container-low)', fontSize: '0.85rem' }}>
      <MethodBadge method={ep.method} />
      <code style={{ flex: 1, color: 'var(--on-surface)', fontSize: '0.8rem' }}>{ep.path}</code>
      <span style={{ color: 'var(--outline)', fontSize: '0.75rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.summary}</span>
      {ep.has_body && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface-container-high)', color: 'var(--on-surface-variant)' }}>body</span>}
    </div>
  );
}

function TestResultRow({ result }) {
  const [expanded, setExpanded] = useState(false);
  const passed = result.passed;
  const hasError = result.error;

  return (
    <div style={{ borderBottom: '1px solid var(--surface-container-low)' }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', cursor: 'pointer', fontSize: '0.82rem' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: hasError ? '#b45309' : passed ? '#16a34a' : 'var(--error)', fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>
          {hasError ? 'warning' : passed ? 'check_circle' : 'cancel'}
        </span>
        <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, background: result.type === 'positive' ? '#dbeafe' : '#fce7f3', color: result.type === 'positive' ? '#1e40af' : '#9d174d', flexShrink: 0 }}>
          {result.type}
        </span>
        <span style={{ flex: 1, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.name}</span>
        {result.actual_status > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: result.actual_status < 400 ? '#16a34a' : 'var(--error)', flexShrink: 0 }}>{result.actual_status}</span>
        )}
        {result.response_time_ms > 0 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--outline)', flexShrink: 0 }}>{result.response_time_ms}ms</span>
        )}
        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--outline)', flexShrink: 0 }}>{expanded ? 'expand_less' : 'expand_more'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 12px', background: 'var(--surface-container-lowest)' }}>
          {result.error && (
            <div style={{ padding: '8px', background: 'var(--error-container)', borderRadius: '6px', color: 'var(--error)', fontSize: '0.75rem', marginBottom: '8px', fontFamily: 'monospace' }}>
              {result.error}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--outline)', marginBottom: '6px', fontFamily: 'monospace' }}>
            {result.method} {result.request_url || result.path}
            {result.expected_status > 0 && ` → expected ${result.expected_status}`}
          </div>
          {result.assertions?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', marginBottom: '4px' }}>Assertions</div>
              {result.assertions.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.75rem', marginBottom: '3px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '12px', color: a.passed ? '#16a34a' : 'var(--error)', fontVariationSettings: "'FILL' 1" }}>
                    {a.passed ? 'check_circle' : 'cancel'}
                  </span>
                  <span style={{ color: 'var(--on-surface)' }}>{a.assertion}</span>
                  {a.actual && <span style={{ color: 'var(--outline)', fontFamily: 'monospace' }}>({a.actual})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EndpointResultCard({ ep }) {
  const [expanded, setExpanded] = useState(false);
  const total = ep.tests?.length || 0;
  const passed = ep.passed || 0;
  const failed = ep.failed || 0;

  return (
    <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '10px', marginBottom: '8px', overflow: 'hidden', borderLeft: `3px solid ${failed > 0 ? 'var(--error)' : '#16a34a'}` }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', cursor: 'pointer' }}>
        <MethodBadge method={ep.method} />
        <code style={{ flex: 1, fontSize: '0.82rem', color: 'var(--on-surface)' }}>{ep.path}</code>
        {ep.summary && <span style={{ fontSize: '0.75rem', color: 'var(--outline)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.summary}</span>}
        <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>{passed}✓</span>
        {failed > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--error)', fontWeight: 600 }}>{failed}✗</span>}
        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)' }}>{expanded ? 'expand_less' : 'expand_more'}</span>
      </div>
      {expanded && ep.tests?.length > 0 && (
        <div style={{ borderTop: '1px solid var(--surface-container-low)' }}>
          {ep.tests.map((t, i) => <TestResultRow key={i} result={t} />)}
        </div>
      )}
    </div>
  );
}

export default function ApiTesting() {
  const [specText, setSpecText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [parsedSpec, setParsedSpec] = useState(null);   // { spec_info, endpoints, raw_spec }
  const [parsing, setParsing] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);           // per-endpoint result cards
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const logsEndRef = useRef(null);

  const scrollLogs = () => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSpecText(ev.target.result);
    reader.readAsText(file);
  };

  const handleParseSpec = async () => {
    setError(null);
    setParsedSpec(null);
    setParsing(true);
    try {
      const res = await api.post('/apitest/upload', { spec_content: specText });
      setParsedSpec(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to parse spec');
    } finally {
      setParsing(false);
    }
  };

  const handleRunTests = async () => {
    if (!parsedSpec) return;
    setError(null);
    setResults([]);
    setLogs([]);
    setSummary(null);
    setRunning(true);

    const token = localStorage.getItem('bughunter_token');

    try {
      const response = await fetch('/api/apitest/collection-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spec: parsedSpec.raw_spec, base_url: baseUrl }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double-newlines (SSE message boundaries)
        const messages = buffer.split(/\n\n/);
        buffer = messages.pop() || '';  // keep incomplete last chunk

        for (const message of messages) {
          let eventType = '';
          let data = '';
          for (const line of message.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (!data || data === '{}') continue;
          try {
            const payload = JSON.parse(data);

            if (eventType === 'log' || payload.message) {
              const msg = payload.message || (typeof payload === 'string' ? payload : null);
              if (msg) { setLogs(prev => [...prev, msg]); scrollLogs(); }
            }
            if (eventType === 'complete' && payload.results) {
              setSummary(payload);
            }
            if (eventType === 'endpoint_complete' && payload.tests && payload.method) {
              setResults(prev => [...prev, payload]);
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      setError(err.message || 'Connection failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-tertiary-container)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '6px' }}>AI-Powered Testing</span>
        <h2 style={{ fontSize: '2.25rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '6px' }}>API Testing</h2>
        <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem' }}>Upload an OpenAPI/Swagger spec — the AI generates and executes test cases per endpoint.</p>
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Step 1: Upload spec */}
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid var(--outline-variant)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
          <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>1</span>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--on-surface)' }}>Upload or paste your OpenAPI spec (JSON)</span>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <button onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'transparent', color: 'var(--on-surface)', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 500 }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>upload_file</span>
            Upload JSON file
          </button>
          <input ref={fileInputRef} type="file" accept=".json,.yaml,.yml" style={{ display: 'none' }} onChange={handleFileUpload} />
        </div>

        <textarea
          value={specText}
          onChange={e => setSpecText(e.target.value)}
          placeholder='Paste your OpenAPI/Swagger JSON here…'
          rows={8}
          style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)', fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
        />

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' }}>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="Base URL (e.g. https://api.example.com)"
            style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)', fontSize: '0.85rem' }}
          />
          <button
            onClick={handleParseSpec}
            disabled={!specText.trim() || parsing}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', borderRadius: '8px', background: 'var(--secondary)', color: '#fff', border: 'none', fontSize: '0.85rem', fontWeight: 600, cursor: !specText.trim() || parsing ? 'not-allowed' : 'pointer', opacity: !specText.trim() || parsing ? 0.6 : 1 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>document_scanner</span>
            {parsing ? 'Parsing…' : 'Parse Spec'}
          </button>
        </div>
      </div>

      {/* Step 2: Endpoint list */}
      {parsedSpec && (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem', border: '1px solid var(--outline-variant)' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--outline-variant)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>2</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--on-surface)' }}>{parsedSpec.spec_info?.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--outline)' }}>{parsedSpec.endpoints?.length} endpoint{parsedSpec.endpoints?.length !== 1 ? 's' : ''} detected{parsedSpec.spec_info?.version ? ` · v${parsedSpec.spec_info.version}` : ''}</div>
            </div>
            <button
              onClick={handleRunTests}
              disabled={running}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', borderRadius: '8px', background: running ? 'var(--outline)' : 'var(--primary)', color: '#fff', border: 'none', fontSize: '0.85rem', fontWeight: 600, cursor: running ? 'wait' : 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>play_arrow</span>
              {running ? 'Running…' : 'Run Tests'}
            </button>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {parsedSpec.endpoints?.map((ep, i) => <EndpointRow key={i} ep={ep} />)}
          </div>
        </div>
      )}

      {/* Step 3: Live logs + results */}
      {(logs.length > 0 || results.length > 0 || summary) && (
        <div>
          {/* Summary bar */}
          {summary && (
            <div style={{ display: 'flex', gap: '12px', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Endpoints', value: summary.endpoints, color: 'var(--secondary)' },
                { label: 'Tests', value: summary.tests, color: 'var(--on-surface)' },
                { label: 'Passed', value: summary.passed, color: '#16a34a' },
                { label: 'Failed', value: summary.failed, color: 'var(--error)' },
                { label: 'Duration', value: `${(summary.duration_ms / 1000).toFixed(1)}s`, color: 'var(--outline)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '10px 16px', textAlign: 'center', border: '1px solid var(--outline-variant)', minWidth: '80px' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Live log console */}
          {logs.length > 0 && (
            <div style={{ background: '#0f172a', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', maxHeight: '180px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8' }}>
              {logs.map((line, i) => (
                <div key={i} style={{ marginBottom: '3px' }}>
                  <span style={{ color: '#475569' }}>›</span> {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}

          {/* Results per endpoint */}
          {results.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', marginBottom: '10px' }}>Test Results</div>
              {results.map((ep, i) => <EndpointResultCard key={i} ep={ep} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
