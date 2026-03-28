"""
BugHunter.AI - Python Agent API Server
Lightweight Flask server that exposes AI-powered endpoints for the Node.js
backend to call. Runs alongside the Redis worker in a background thread.

Endpoints:
  POST /generate-tests          — Generate Gherkin BDD feature file from bug reports
  POST /apitest/upload          — Parse an OpenAPI/Swagger spec
  POST /apitest/collection-stream — SSE: AI-generate + execute API test cases
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import traceback

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

log = logging.getLogger("bughunter.api_server")

app = Flask(__name__)
CORS(app)


# ── BDD Test Generation ───────────────────────────────────────────────────────

@app.route("/generate-tests", methods=["POST"])
def generate_tests():
    """Generate a Gherkin .feature file from a run's bug reports."""
    data = request.get_json(force=True)
    bugs = data.get("bugs", [])
    app_url = data.get("app_url", "")
    run_id = data.get("run_id", "")

    if not bugs:
        return jsonify({"error": "No bugs provided to generate tests from"}), 400

    try:
        from generators.bdd_generator import generate_bdd_from_bugs
        content = generate_bdd_from_bugs(bugs, app_url)

        import re
        domain = re.sub(r"https?://", "", app_url).split("/")[0].replace(".", "_")
        run_suffix = run_id[:8] if run_id else "test"
        filename = f"regression_{domain}_{run_suffix}.feature"

        return jsonify({"feature_content": content, "filename": filename})

    except Exception as exc:
        log.error("generate-tests failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


# ── API Collection Testing ────────────────────────────────────────────────────

@app.route("/apitest/upload", methods=["POST"])
def apitest_upload():
    """Parse an OpenAPI/Swagger JSON spec and return the endpoint list."""
    data = request.get_json(force=True)
    spec_content = data.get("spec_content", "")

    if not spec_content:
        return jsonify({"error": "No spec_content provided"}), 400

    try:
        from integrations.api_collection_runner import parse_openapi_spec
        spec_info, endpoints = parse_openapi_spec(spec_content)

        return jsonify({
            "spec_info": spec_info,
            "endpoints": [
                {
                    "method": ep.method,
                    "path": ep.path,
                    "summary": ep.summary,
                    "description": ep.description,
                    "operation_id": ep.operation_id,
                    "tags": ep.tags,
                    "has_body": bool(ep.request_body),
                    "param_count": len(ep.parameters),
                }
                for ep in endpoints
            ],
            "raw_spec": spec_content,
        })

    except Exception as exc:
        log.error("apitest/upload failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/apitest/collection-stream", methods=["POST"])
def apitest_collection_stream():
    """SSE endpoint: generate AI test cases and execute them against the API."""
    data = request.get_json(force=True)
    base_url = data.get("base_url", "").strip()
    raw_spec = data.get("spec", "").strip()

    if not raw_spec:
        return jsonify({"error": "No spec provided"}), 400

    event_queue: queue.Queue = queue.Queue()

    def _on_progress(event_type, payload):
        event_queue.put((event_type, payload))

    def _run():
        try:
            from integrations.api_collection_runner import run_collection_tests
            run_collection_tests(raw_spec, base_url, on_progress=_on_progress)
        except Exception as exc:
            event_queue.put(("error_event", str(exc)))
        finally:
            event_queue.put(("done", None))

    threading.Thread(target=_run, daemon=True).start()

    def generate():
        while True:
            try:
                event_type, ev_data = event_queue.get(timeout=300)
            except queue.Empty:
                yield "event: ping\ndata: {}\n\n"
                continue

            if event_type == "done":
                break

            if isinstance(ev_data, (dict, list)):
                payload = json.dumps(ev_data)
            else:
                payload = json.dumps({"message": str(ev_data)})

            yield f"event: {event_type}\ndata: {payload}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Health ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "bughunter-agent-api"})


def start(port: int = 5001):
    """Start the Flask API server (blocking — call from a daemon thread)."""
    log.info(f"Agent API server starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
