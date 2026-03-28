"""
QA OneShop Stop — Autonomous BDD Test Case Generator
=====================================================
Flask application that generates Cucumber/Gherkin feature files from:
  - Free-text user stories
  - Jira issues (single key or JQL bulk)
  - Confluence pages
  - Figma design files
  - Any combination of the above
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import traceback

from flask import Flask, Response, jsonify, render_template, request
from flask_cors import CORS

from config import Config
from generators.feature_generator import (
    generate_from_confluence,
    generate_from_figma,
    generate_from_jira,
    generate_from_jira_jql,
    generate_from_multiple_sources,
    generate_from_user_story,
    parse_test_scenarios,
)
from integrations.jira_client import JiraClient
from integrations.smoke_runner import run_smoke_test
from integrations.api_test_runner import (
    detect_frameworks,
    resolve_repo_path,
    run_tests,
    DetectedFramework,
)
from integrations.api_collection_runner import (
    parse_openapi_spec,
    run_collection_tests,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


@app.route("/")
def qahub():
    return render_template("qahub.html")


@app.route("/generator")
def generator():
    return render_template("index.html")


@app.route("/smoketest")
def smoketest():
    return render_template("smoketest.html")


@app.route("/api/generate", methods=["POST"])
def api_generate():
    """
    Unified generation endpoint.

    Expects JSON with a "source" field and source-specific parameters.
    Returns the generated .feature content and the saved filepath.
    """
    data = request.get_json(force=True)
    source = data.get("source", "")
    extra = data.get("extra_instructions", "")
    output_format = data.get("output_format", "feature")

    try:
        if source == "user_story":
            result = generate_from_user_story(
                story_text=data.get("story_text", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
        elif source == "jira":
            result = generate_from_jira(
                issue_key=data.get("issue_key", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
        elif source == "jira_jql":
            results = generate_from_jira_jql(
                jql=data.get("jql", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
            combined_content = "\n\n".join(r["feature_content"] for r in results)
            result = {
                "source": "jira_jql",
                "output_format": output_format,
                "count": len(results),
                "feature_content": combined_content,
                "filepath": ", ".join(r["filepath"] for r in results),
                "details": results,
            }
        elif source == "confluence":
            result = generate_from_confluence(
                page_id_or_url=data.get("page_url", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
        elif source == "figma":
            result = generate_from_figma(
                file_key_or_url=data.get("figma_url", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
        elif source == "multi":
            result = generate_from_multiple_sources(
                user_story=data.get("story_text", ""),
                jira_key=data.get("jira_key", ""),
                confluence_url=data.get("confluence_url", ""),
                figma_url=data.get("figma_url", ""),
                extra_instructions=extra,
                output_format=output_format,
            )
        else:
            return jsonify({"error": f"Unknown source: {source}"}), 400

        return jsonify(result)

    except Exception as exc:
        log.error("Generation failed: %s\n%s", exc, traceback.format_exc())
        # #region agent log
        import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"app.py:api_generate:error","message":"generation_endpoint_error","data":{"error_type":type(exc).__name__,"error_msg":str(exc),"source":source,"output_format":output_format},"timestamp":int(_time.time()*1000),"hypothesisId":"D,E"})+"\n"); _lf.close()
        # #endregion
        return jsonify({"error": str(exc)}), 500


@app.route("/api/smoketest/execute", methods=["POST"])
def api_smoketest_execute():
    """Run a Playwright-based smoke test suite against a target URL."""
    data = request.get_json(force=True)
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"error": "Please provide a target URL."}), 400

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    credentials = None
    if data.get("user_id"):
        credentials = {"user_id": data["user_id"], "password": data.get("password", "")}

    try:
        log.info("Starting smoke test for: %s", url)
        report = run_smoke_test(url, credentials=credentials)
        return jsonify(report)
    except Exception as exc:
        log.error("Smoke test failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/api/smoketest/stream")
def api_smoketest_stream():
    """SSE endpoint that streams smoke test logs and check results in real time."""
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "Please provide a target URL."}), 400
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    credentials = None
    user_id = request.args.get("user_id", "").strip()
    password = request.args.get("password", "")
    if user_id:
        credentials = {"user_id": user_id, "password": password}

    event_queue: queue.Queue = queue.Queue()

    def _on_progress(event_type, data):
        event_queue.put((event_type, data))

    smoke_log = logging.getLogger("integrations.smoke_runner")
    handler = _QueueLogHandler(event_queue)
    handler.setLevel(logging.DEBUG)
    smoke_log.addHandler(handler)

    def _run():
        try:
            run_smoke_test(url, on_progress=_on_progress, credentials=credentials)
        except Exception as exc:
            event_queue.put(("error_event", str(exc)))
        finally:
            smoke_log.removeHandler(handler)
            event_queue.put(("done", None))

    threading.Thread(target=_run, daemon=True).start()

    def generate():
        while True:
            try:
                event_type, data = event_queue.get(timeout=300)
            except queue.Empty:
                yield "event: ping\ndata: {}\n\n"
                continue

            if event_type == "done":
                break

            if isinstance(data, (dict, list)):
                payload = json.dumps(data)
            else:
                payload = json.dumps({"message": str(data)})

            yield f"event: {event_type}\ndata: {payload}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@app.route("/output/<path:filename>")
def serve_output_file(filename):
    """Serve generated reports and files from the output directory."""
    from flask import send_from_directory
    return send_from_directory(Config.OUTPUT_DIR, filename)


class _QueueLogHandler(logging.Handler):
    """Logging handler that pushes formatted log records into a queue as SSE events."""

    def __init__(self, q: queue.Queue):
        super().__init__()
        self._q = q

    def emit(self, record):
        try:
            msg = self.format(record) if self.formatter else record.getMessage()
            self._q.put(("log", f"[{record.levelname}] {msg}"))
        except Exception:
            pass


@app.route("/api/jira/preview", methods=["POST"])
def api_jira_preview():
    """Fetch and return Jira issue details for preview."""
    data = request.get_json(force=True)
    issue_key = data.get("issue_key", "").strip()

    if not issue_key:
        return jsonify({"error": "Please provide a Jira issue key."}), 400

    try:
        client = JiraClient()
        req = client.fetch_issue(issue_key)
        return jsonify({
            "key": req.key,
            "summary": req.summary,
            "description": req.description,
            "acceptance_criteria": req.acceptance_criteria,
            "issue_type": req.issue_type,
            "priority": req.priority,
            "labels": req.labels,
            "components": req.components,
            "subtasks": req.subtasks,
        })
    except Exception as exc:
        log.error("Jira preview failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/api/parse-scenarios", methods=["POST"])
def api_parse_scenarios():
    """
    Parse generated content into individual test scenarios.

    Expects JSON:
      - feature_content: the generated text (required)
    Returns a JSON array of {id, title, description}.
    """
    data = request.get_json(force=True)
    content = data.get("feature_content", "").strip()

    if not content:
        return jsonify({"error": "No content to parse."}), 400

    try:
        scenarios = parse_test_scenarios(content)
        return jsonify({"scenarios": scenarios})
    except Exception as exc:
        log.error("Parse failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/api/jira/push-testcases", methods=["POST"])
def api_jira_push_testcases():
    """
    Upload test cases to Jira as sub-tasks linked to the given parent issue.

    Accepts EITHER:
      - test_cases: pre-parsed array of {title, description} (preferred)
      - feature_content: raw text to be parsed server-side (fallback)
    Always requires:
      - issue_key: parent Jira issue key
    """
    data = request.get_json(force=True)
    issue_key = data.get("issue_key", "").strip()
    test_cases = data.get("test_cases")
    content = data.get("feature_content", "").strip()

    if not issue_key:
        return jsonify({"error": "Please provide a Jira issue key."}), 400

    try:
        if not test_cases:
            if not content:
                return jsonify({"error": "No test content to upload."}), 400
            test_cases = parse_test_scenarios(content)

        if not test_cases:
            return jsonify({"error": "Could not parse any test cases from the generated content."}), 400

        client = JiraClient()
        result = client.push_test_cases(
            parent_issue_key=issue_key,
            test_cases=test_cases,
        )
        return jsonify(result)

    except Exception as exc:
        log.error("Push to Jira failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/apitest")
def apitest():
    return render_template("apitest.html")


@app.route("/api/apitest/detect", methods=["POST"])
def api_apitest_detect():
    """Detect test frameworks and test files in a given repository."""
    data = request.get_json(force=True)
    repo_input = data.get("repo_path", "").strip()

    if not repo_input:
        return jsonify({"error": "Please provide a repository path or Git URL."}), 400

    try:
        repo_path = resolve_repo_path(repo_input)
        frameworks = detect_frameworks(repo_path)

        return jsonify({
            "repo_path": str(repo_path),
            "frameworks": [
                {
                    "name": fw.name,
                    "display_name": fw.display_name,
                    "command": fw.command,
                    "config_file": fw.config_file,
                    "test_files": fw.test_files,
                    "test_file_count": len(fw.test_files),
                    "confidence": fw.confidence,
                }
                for fw in frameworks
            ],
        })

    except Exception as exc:
        log.error("API test detect failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/api/apitest/stream")
def api_apitest_stream():
    """SSE endpoint that streams test execution output in real time."""
    repo_input = request.args.get("repo_path", "").strip()
    fw_name = request.args.get("framework", "").strip()
    custom_cmd = request.args.get("command", "").strip()

    if not repo_input:
        return jsonify({"error": "Please provide a repository path."}), 400

    event_queue: queue.Queue = queue.Queue()

    def _on_progress(event_type, data):
        event_queue.put((event_type, data))

    def _run():
        try:
            repo_path = resolve_repo_path(repo_input, on_progress=_on_progress)
            frameworks = detect_frameworks(repo_path)

            fw = None
            if fw_name:
                fw = next((f for f in frameworks if f.name == fw_name), None)
            if not fw and frameworks:
                fw = frameworks[0]
            if not fw:
                event_queue.put(("error_event", "No test framework detected in this repository."))
                event_queue.put(("done", None))
                return

            _on_progress("log", f"Using framework: {fw.display_name}")
            _on_progress("log", f"Test files found: {len(fw.test_files)}")
            _on_progress("framework", {
                "name": fw.name,
                "display_name": fw.display_name,
                "command": custom_cmd or fw.command,
                "test_file_count": len(fw.test_files),
            })

            run_tests(repo_path, fw, custom_command=custom_cmd, on_progress=_on_progress)
        except Exception as exc:
            event_queue.put(("error_event", str(exc)))
        finally:
            event_queue.put(("done", None))

    threading.Thread(target=_run, daemon=True).start()

    def generate():
        while True:
            try:
                event_type, data = event_queue.get(timeout=300)
            except queue.Empty:
                yield "event: ping\ndata: {}\n\n"
                continue

            if event_type == "done":
                break

            if isinstance(data, dict):
                payload = json.dumps(data)
            else:
                payload = json.dumps({"message": str(data)})

            yield f"event: {event_type}\ndata: {payload}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@app.route("/api/apitest/upload", methods=["POST"])
def api_apitest_upload():
    """Accept an OpenAPI/Swagger JSON file and return parsed endpoints."""
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename."}), 400

    try:
        content = uploaded.read().decode("utf-8")
        spec_info, endpoints = parse_openapi_spec(content)

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
            "raw_spec": content,
        })

    except Exception as exc:
        log.error("OpenAPI upload failed: %s\n%s", exc, traceback.format_exc())
        return jsonify({"error": str(exc)}), 500


@app.route("/api/apitest/collection-stream", methods=["POST"])
def api_apitest_collection_stream():
    """SSE endpoint that generates AI test cases and executes them against the API."""
    data = request.get_json(force=True)
    base_url = data.get("base_url", "").strip()
    raw_spec = data.get("spec", "").strip()

    if not raw_spec:
        return jsonify({"error": "No spec provided."}), 400

    event_queue: queue.Queue = queue.Queue()

    def _on_progress(event_type, data_payload):
        event_queue.put((event_type, data_payload))

    def _run():
        try:
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

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "provider": Config.AI_PROVIDER})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=Config.FLASK_PORT, debug=True)
