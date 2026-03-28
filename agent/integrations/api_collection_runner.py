"""
BugHunter.AI - API Collection Test Runner
Ported from QA OneShop Stop (integrations/api_collection_runner.py).

Parses an OpenAPI / Swagger specification, uses AI to generate positive and
negative test cases for each endpoint, executes them via HTTP requests, and
streams results through a progress callback.

Key adaptation: uses BugHunter's providers.get_llm() (LangChain) instead of
the raw OpenAI client used in the original.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import requests as http_client
from langchain_core.messages import HumanMessage, SystemMessage

log = logging.getLogger("bughunter.api_collection_runner")

API_TEST_SYSTEM_PROMPT = """You are an API testing expert. Generate comprehensive test cases for API endpoints.

For each endpoint, create:
- 3-5 positive test cases (valid inputs, expected successful responses)
- 3-5 negative test cases (invalid inputs, missing required fields, wrong types, boundary values)

Return ONLY a JSON array of test case objects. Each object must have:
{
  "name": "descriptive test name",
  "type": "positive" or "negative",
  "method": "HTTP method",
  "path": "endpoint path",
  "headers": {"Content-Type": "application/json"},
  "body": null or request body object,
  "query_params": {},
  "expected_status": integer HTTP status code,
  "assertions": ["list of assertion strings like 'response is not empty', 'contains field id'"]
}

Return ONLY the JSON array, no extra text.
"""


@dataclass
class EndpointSpec:
    method: str
    path: str
    operation_id: str = ""
    summary: str = ""
    description: str = ""
    parameters: list[dict] = field(default_factory=list)
    request_body: dict = field(default_factory=dict)
    responses: dict = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)


@dataclass
class TestCaseResult:
    name: str
    test_type: str  # positive | negative
    method: str
    path: str
    request_url: str = ""
    request_headers: dict = field(default_factory=dict)
    request_body: Any = None
    expected_status: int = 200
    actual_status: int = 0
    response_body: Any = None
    response_time_ms: int = 0
    passed: bool = False
    error: str = ""
    assertions: list[str] = field(default_factory=list)
    assertion_results: list[dict] = field(default_factory=list)


def parse_openapi_spec(content: str | dict) -> tuple[dict, list[EndpointSpec]]:
    """Parse an OpenAPI 3.x or Swagger 2.0 JSON spec and extract endpoints.

    Returns (spec_info, endpoints).
    """
    if isinstance(content, str):
        spec = json.loads(content)
    else:
        spec = content

    info = spec.get("info", {})
    spec_info = {
        "title": info.get("title", "Untitled API"),
        "version": info.get("version", ""),
        "description": info.get("description", ""),
    }

    servers = spec.get("servers", [])
    if servers:
        spec_info["base_url"] = servers[0].get("url", "")
    elif "host" in spec:
        scheme = (spec.get("schemes") or ["https"])[0]
        base_path = spec.get("basePath", "")
        spec_info["base_url"] = f"{scheme}://{spec['host']}{base_path}"
    else:
        spec_info["base_url"] = ""

    endpoints: list[EndpointSpec] = []
    paths = spec.get("paths", {})

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            operation = path_item.get(method)
            if not operation or not isinstance(operation, dict):
                continue

            params = _merge_parameters(
                path_item.get("parameters", []),
                operation.get("parameters", []),
            )

            req_body = {}
            if "requestBody" in operation:
                req_body = _extract_request_body(operation["requestBody"], spec)

            responses = {}
            for status_code, resp_obj in operation.get("responses", {}).items():
                if isinstance(resp_obj, dict):
                    responses[status_code] = {
                        "description": resp_obj.get("description", ""),
                        "schema": _extract_response_schema(resp_obj, spec),
                    }

            endpoints.append(EndpointSpec(
                method=method.upper(),
                path=path,
                operation_id=operation.get("operationId", ""),
                summary=operation.get("summary", ""),
                description=operation.get("description", ""),
                parameters=params,
                request_body=req_body,
                responses=responses,
                tags=operation.get("tags", []),
            ))

    return spec_info, endpoints


def _merge_parameters(path_params: list, op_params: list) -> list[dict]:
    by_key = {}
    for p in path_params:
        if isinstance(p, dict):
            key = (p.get("name", ""), p.get("in", ""))
            by_key[key] = p
    for p in op_params:
        if isinstance(p, dict):
            key = (p.get("name", ""), p.get("in", ""))
            by_key[key] = p
    return list(by_key.values())


def _resolve_ref(ref: str, spec: dict) -> dict:
    if not ref.startswith("#/"):
        return {}
    parts = ref.lstrip("#/").split("/")
    node = spec
    for part in parts:
        if isinstance(node, dict):
            node = node.get(part, {})
        else:
            return {}
    return node if isinstance(node, dict) else {}


def _extract_request_body(rb: dict, spec: dict) -> dict:
    if "$ref" in rb:
        rb = _resolve_ref(rb["$ref"], spec)
    content = rb.get("content", {})
    for media_type in ("application/json", "application/xml", "multipart/form-data"):
        if media_type in content:
            schema = content[media_type].get("schema", {})
            if "$ref" in schema:
                schema = _resolve_ref(schema["$ref"], spec)
            return {
                "media_type": media_type,
                "required": rb.get("required", False),
                "schema": _simplify_schema(schema, spec),
            }
    if content:
        first_type = next(iter(content))
        schema = content[first_type].get("schema", {})
        if "$ref" in schema:
            schema = _resolve_ref(schema["$ref"], spec)
        return {
            "media_type": first_type,
            "required": rb.get("required", False),
            "schema": _simplify_schema(schema, spec),
        }
    return {}


def _extract_response_schema(resp: dict, spec: dict) -> dict:
    content = resp.get("content", {})
    if "application/json" in content:
        schema = content["application/json"].get("schema", {})
        if "$ref" in schema:
            schema = _resolve_ref(schema["$ref"], spec)
        return _simplify_schema(schema, spec)
    if "schema" in resp:
        schema = resp["schema"]
        if "$ref" in schema:
            schema = _resolve_ref(schema["$ref"], spec)
        return _simplify_schema(schema, spec)
    return {}


def _simplify_schema(schema: dict, spec: dict, depth: int = 0) -> dict:
    if depth > 3 or not schema:
        return schema
    if "$ref" in schema:
        schema = _resolve_ref(schema["$ref"], spec)
    result: dict = {}
    for key in ("type", "format", "enum", "required", "description",
                "minimum", "maximum", "minLength", "maxLength", "pattern",
                "example", "default"):
        if key in schema:
            result[key] = schema[key]
    if "properties" in schema and isinstance(schema["properties"], dict):
        result["properties"] = {
            k: _simplify_schema(v, spec, depth + 1)
            for k, v in schema["properties"].items()
            if isinstance(v, dict)
        }
    if "items" in schema and isinstance(schema["items"], dict):
        result["items"] = _simplify_schema(schema["items"], spec, depth + 1)
    return result


def _build_endpoint_context(endpoint: EndpointSpec) -> str:
    lines = [f"Method: {endpoint.method}", f"Path: {endpoint.path}"]
    if endpoint.summary:
        lines.append(f"Summary: {endpoint.summary}")
    if endpoint.description:
        lines.append(f"Description: {endpoint.description}")
    if endpoint.parameters:
        lines.append(f"Parameters: {json.dumps(endpoint.parameters, indent=2)}")
    if endpoint.request_body:
        lines.append(f"Request Body: {json.dumps(endpoint.request_body, indent=2)}")
    if endpoint.responses:
        lines.append(f"Responses: {json.dumps(endpoint.responses, indent=2)}")
    return "\n".join(lines)


def _generate_api_test_cases(endpoint_context: str) -> str:
    """Call the configured LLM to generate test cases for an endpoint."""
    from providers import get_llm
    llm = get_llm()
    response = llm.invoke([
        SystemMessage(content=API_TEST_SYSTEM_PROMPT),
        HumanMessage(content=f"Generate test cases for this API endpoint:\n\n{endpoint_context}"),
    ])
    return response.content


def _parse_ai_test_cases(ai_response: str) -> list[dict]:
    text = ai_response.strip()
    if text.startswith("```"):
        lines = text.split("\n")[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "test_cases" in parsed:
            return parsed["test_cases"]
        if isinstance(parsed, list):
            return parsed
        return []
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
        log.warning("Could not parse AI response as JSON test cases")
        return []


def execute_test_case(base_url: str, test_case: dict, timeout: int = 30) -> TestCaseResult:
    """Execute a single API test case and return the result."""
    method = test_case.get("method", "GET").upper()
    path = test_case.get("path", "/")
    headers = test_case.get("headers", {})
    body = test_case.get("body")
    query_params = test_case.get("query_params", {})
    expected_status = test_case.get("expected_status", 200)
    assertions = test_case.get("assertions", [])

    url = base_url.rstrip("/") + path
    result = TestCaseResult(
        name=test_case.get("name", f"{method} {path}"),
        test_type=test_case.get("type", "positive"),
        method=method,
        path=path,
        request_url=url,
        request_headers=headers,
        request_body=body,
        expected_status=expected_status,
        assertions=assertions,
    )

    try:
        start = time.perf_counter()
        resp = http_client.request(
            method=method,
            url=url,
            headers=headers,
            json=body if body and isinstance(body, (dict, list)) else None,
            data=body if body and isinstance(body, str) else None,
            params=query_params if query_params else None,
            timeout=timeout,
            verify=False,
        )
        elapsed = int((time.perf_counter() - start) * 1000)

        result.actual_status = resp.status_code
        result.response_time_ms = elapsed
        try:
            result.response_body = resp.json()
        except Exception:
            result.response_body = resp.text[:2000] if resp.text else ""

        status_match = resp.status_code == expected_status
        result.assertion_results.append({
            "assertion": f"Status code is {expected_status}",
            "passed": status_match,
            "actual": str(resp.status_code),
        })

        resp_text = resp.text.lower() if resp.text else ""
        for assertion in assertions:
            assertion_lower = assertion.lower()
            if "contains" in assertion_lower:
                keyword = assertion_lower.split("contains")[-1].strip().strip("'\"")
                a_passed = keyword in resp_text
            elif "not empty" in assertion_lower:
                a_passed = bool(resp.text and resp.text.strip())
            elif "is array" in assertion_lower or "is list" in assertion_lower:
                a_passed = isinstance(result.response_body, list)
            elif "is object" in assertion_lower:
                a_passed = isinstance(result.response_body, dict)
            else:
                a_passed = True
            result.assertion_results.append({
                "assertion": assertion,
                "passed": a_passed,
                "actual": "checked",
            })

        result.passed = all(ar["passed"] for ar in result.assertion_results)

    except http_client.exceptions.Timeout:
        result.error = f"Request timed out after {timeout}s"
    except http_client.exceptions.ConnectionError as exc:
        result.error = f"Connection error: {exc}"
    except Exception as exc:
        result.error = str(exc)

    return result


def run_collection_tests(
    spec_content: str | dict,
    base_url: str,
    on_progress: Optional[Callable] = None,
) -> dict:
    """Parse spec, generate AI test cases, execute, and stream results.

    Returns a summary dict with overall stats and per-endpoint results.
    """
    def _emit(event_type: str, data):
        if on_progress:
            try:
                on_progress(event_type, data)
            except Exception:
                pass

    _emit("log", "Parsing OpenAPI specification…")
    try:
        spec_info, endpoints = parse_openapi_spec(spec_content)
    except Exception as exc:
        raise ValueError(f"Failed to parse OpenAPI spec: {exc}") from exc

    if not endpoints:
        raise ValueError("No API endpoints found in the specification.")

    _emit("log", f"Found {len(endpoints)} endpoint(s) in '{spec_info['title']}'")
    _emit("spec_info", {
        "title": spec_info["title"],
        "version": spec_info["version"],
        "endpoint_count": len(endpoints),
    })

    if not base_url:
        base_url = spec_info.get("base_url", "")
    if not base_url:
        raise ValueError("No base URL provided and none found in the spec.")
    if not base_url.startswith(("http://", "https://")):
        base_url = "https://" + base_url

    _emit("log", f"Base URL: {base_url}")

    totals = {"endpoints": 0, "tests": 0, "passed": 0, "failed": 0, "errors": 0, "duration_ms": 0}
    all_results: list[dict] = []
    overall_start = time.perf_counter()

    for idx, ep in enumerate(endpoints):
        ep_key = f"{ep.method} {ep.path}"
        _emit("endpoint_start", {
            "index": idx,
            "total": len(endpoints),
            "method": ep.method,
            "path": ep.path,
            "summary": ep.summary,
        })
        _emit("log", f"[{idx + 1}/{len(endpoints)}] Generating tests for {ep_key}…")

        context = _build_endpoint_context(ep)
        try:
            ai_response = _generate_api_test_cases(context)
            test_cases = _parse_ai_test_cases(ai_response)
        except Exception as exc:
            _emit("log", f"AI generation failed for {ep_key}: {exc}")
            test_cases = []

        if not test_cases:
            _emit("log", f"No test cases generated for {ep_key}, using defaults")
            test_cases = _create_default_test_cases(ep)

        _emit("test_generated", {
            "method": ep.method,
            "path": ep.path,
            "count": len(test_cases),
            "tests": [{"name": tc.get("name", ""), "type": tc.get("type", "")} for tc in test_cases],
        })

        ep_results = []
        for tc in test_cases:
            tc.setdefault("method", ep.method)
            tc.setdefault("path", ep.path)

            result = execute_test_case(base_url, tc)
            totals["tests"] += 1
            if result.error:
                totals["errors"] += 1
            elif result.passed:
                totals["passed"] += 1
            else:
                totals["failed"] += 1

            result_dict = {
                "name": result.name,
                "type": result.test_type,
                "method": result.method,
                "path": result.path,
                "request_url": result.request_url,
                "expected_status": result.expected_status,
                "actual_status": result.actual_status,
                "response_time_ms": result.response_time_ms,
                "passed": result.passed,
                "error": result.error,
                "assertions": result.assertion_results,
            }
            ep_results.append(result_dict)
            _emit("test_result", result_dict)

        totals["endpoints"] += 1
        ep_passed = sum(1 for r in ep_results if r["passed"])
        _emit("endpoint_complete", {
            "index": idx,
            "method": ep.method,
            "path": ep.path,
            "total": len(ep_results),
            "passed": ep_passed,
            "failed": len(ep_results) - ep_passed,
        })
        all_results.append({
            "method": ep.method,
            "path": ep.path,
            "summary": ep.summary,
            "tests": ep_results,
            "passed": ep_passed,
            "failed": len(ep_results) - ep_passed,
        })

    totals["duration_ms"] = int((time.perf_counter() - overall_start) * 1000)
    summary = {**totals, "results": all_results}
    _emit("complete", summary)
    return summary


def _create_default_test_cases(ep: EndpointSpec) -> list[dict]:
    return [
        {
            "name": f"{ep.method} {ep.path} — valid request",
            "type": "positive",
            "method": ep.method,
            "path": ep.path,
            "headers": {"Content-Type": "application/json"},
            "expected_status": 200,
            "assertions": ["response is not empty"],
        },
        {
            "name": f"{ep.method} {ep.path} — invalid path",
            "type": "negative",
            "method": ep.method,
            "path": ep.path + "/nonexistent-" + str(int(time.time())),
            "headers": {"Content-Type": "application/json"},
            "expected_status": 404,
            "assertions": [],
        },
    ]
