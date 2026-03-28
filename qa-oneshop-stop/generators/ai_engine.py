"""AI engine that wraps Cursor / OpenAI / Azure OpenAI for BDD generation."""

from __future__ import annotations

import logging

from openai import AzureOpenAI, OpenAI

from config import Config

log = logging.getLogger(__name__)

CURSOR_BASE_URL = "https://api.cursor.com/v1"


def _build_client() -> OpenAI | AzureOpenAI:
    # #region agent log
    import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:_build_client","message":"build_client_entry","data":{"AI_PROVIDER":Config.AI_PROVIDER,"OPENAI_KEY_len":len(Config.OPENAI_API_KEY),"OPENAI_KEY_start":Config.OPENAI_API_KEY[:8] if Config.OPENAI_API_KEY else "EMPTY","OPENAI_KEY_end":Config.OPENAI_API_KEY[-4:] if Config.OPENAI_API_KEY else "EMPTY","CURSOR_KEY_len":len(Config.CURSOR_API_KEY),"model":Config.OPENAI_MODEL},"timestamp":int(_time.time()*1000),"hypothesisId":"A,B,C"})+"\n"); _lf.close()
    # #endregion
    if Config.AI_PROVIDER == "cursor":
        return OpenAI(
            api_key=Config.CURSOR_API_KEY,
            base_url=CURSOR_BASE_URL,
        )
    if Config.AI_PROVIDER == "azure":
        return AzureOpenAI(
            azure_endpoint=Config.AZURE_OPENAI_ENDPOINT,
            api_key=Config.AZURE_OPENAI_API_KEY,
            api_version=Config.AZURE_OPENAI_API_VERSION,
        )
    # #region agent log
    _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:_build_client:openai_branch","message":"using_openai_branch","data":{"key_passed_len":len(Config.OPENAI_API_KEY)},"timestamp":int(_time.time()*1000),"hypothesisId":"C"})+"\n"); _lf.close()
    # #endregion
    return OpenAI(api_key=Config.OPENAI_API_KEY)


def _model_name() -> str:
    if Config.AI_PROVIDER == "cursor":
        return Config.CURSOR_MODEL
    if Config.AI_PROVIDER == "azure":
        return Config.AZURE_OPENAI_DEPLOYMENT
    return Config.OPENAI_MODEL


SYSTEM_PROMPT = """\
You are an expert QA Engineer and BDD specialist. Your job is to generate 
comprehensive Cucumber/Gherkin .feature files from the provided requirement 
context (user stories, Jira tickets, Confluence pages, or Figma designs).

Rules you MUST follow:
1. Output ONLY valid Gherkin syntax — nothing else.
2. Start with a Feature: block that summarises the feature under test.
3. Add a feature-level description paragraph right after the Feature line.
4. Include relevant @tags (e.g. @smoke, @regression, @<jira-key>, @ui, @api).
5. Write Scenario or Scenario Outline blocks covering:
   - Happy path / positive flows
   - Negative / error flows
   - Edge cases and boundary conditions
   - Data-driven scenarios using Examples tables where appropriate
6. Use Given / When / Then / And / But steps.
7. Steps should be concrete and testable, not vague.
8. Where the input mentions UI elements or pages, write UI-oriented steps 
   (e.g. 'When the user clicks the "Submit" button').
9. Where the input mentions API behaviour, write API-oriented steps.
10. Keep scenarios independent of each other.
11. Add a Background block if multiple scenarios share common preconditions.
12. Do NOT include code, explanations, or markdown fences — only .feature content.
"""


TEST_SCENARIO_SYSTEM_PROMPT = """\
You are an expert QA Engineer. Your job is to generate comprehensive manual 
test scenario documents from the provided requirement context (user stories, 
Jira tickets, Confluence pages, or Figma designs).

Rules you MUST follow:
1. Output a structured test scenario document in plain text — nothing else.
2. Start with a header: Test Scenario Document, Feature Name, and Description.
3. For each test scenario include:
   - Scenario ID (e.g. TS-001, TS-002)
   - Scenario Title
   - Priority (High / Medium / Low)
   - Type (Positive / Negative / Edge Case / Boundary)
   - Preconditions
   - Test Steps (numbered, with clear actions)
   - Expected Results (for each step or at the end)
   - Test Data (if applicable)
4. Cover:
   - Happy path / positive flows
   - Negative / error flows
   - Edge cases and boundary conditions
   - UI validation scenarios where applicable
   - Data-driven variations
5. Steps should be concrete, actionable, and testable.
6. Group related scenarios under logical section headings.
7. Include a summary table at the top listing all scenario IDs with titles and priorities.
8. Do NOT include code, markdown fences, or BDD/Gherkin syntax.
"""


SMOKE_TEST_SYSTEM_PROMPT = """\
You are an expert QA Engineer specialising in smoke testing. Your job is to 
generate concise, high-priority smoke test suites from the provided requirement 
context (user stories, Jira tickets, Confluence pages, or Figma designs).

Smoke tests verify that the most critical functionality works after a build or 
deployment. They are NOT exhaustive — they cover only the vital paths.

Rules you MUST follow:
1. Output a structured smoke test document in plain text — nothing else.
2. Start with a header: Smoke Test Suite, Feature Name, Build/Release (placeholder),
   and a brief description of what is being smoke-tested.
3. For each smoke test case include:
   - Test ID (e.g. SM-001, SM-002)
   - Test Title (short, action-oriented)
   - Priority (P0 — Critical / P1 — High)
   - Module / Area
   - Preconditions (brief)
   - Test Steps (numbered, concise actions)
   - Expected Result (clear pass criteria)
4. Focus ONLY on:
   - Core business-critical workflows (login, checkout, data creation, etc.)
   - Happy-path scenarios that must work for the application to be usable
   - Integration points between major modules
   - Key API endpoints returning correct status codes / data
5. Keep the suite small (typically 10–25 tests). Breadth over depth.
6. Group tests by module or functional area.
7. Include a summary table at the top: Test ID, Title, Priority, Module, Status (blank).
8. Add an "Execution Notes" section at the end with placeholders for:
   - Environment, Build Version, Tested By, Date, Overall Result.
9. Do NOT include edge cases, negative tests, or exhaustive coverage — 
   those belong in full regression, not smoke.
10. Do NOT include code, markdown fences, or BDD/Gherkin syntax.
"""


API_TEST_GENERATION_PROMPT = """\
You are an expert API QA Engineer. Your job is to generate both positive and 
negative test cases for a given REST API endpoint based on its OpenAPI specification.

Rules you MUST follow:
1. Output ONLY valid JSON — no explanations, no markdown fences, no extra text.
2. Return a JSON object with a single key "test_cases" containing an array.
3. Generate 3-5 positive test cases that verify the endpoint works correctly:
   - Valid inputs with expected successful responses
   - Different valid parameter combinations
   - Boundary values that should succeed
4. Generate 3-5 negative test cases that verify error handling:
   - Missing required fields
   - Invalid data types
   - Out-of-range values
   - Unauthorized access (if applicable)
   - Malformed input
5. Each test case MUST have these fields:
   - "name": descriptive test name (string)
   - "type": "positive" or "negative" (string)
   - "method": HTTP method (string)
   - "path": API path with path parameters filled in with sample values (string)
   - "headers": request headers object (object, always include Content-Type)
   - "query_params": query parameters object (object, can be empty)
   - "body": request body (object/null — use null for GET/DELETE)
   - "expected_status": expected HTTP status code (integer)
   - "assertions": array of assertion strings (array)
6. For path parameters like {id}, substitute realistic sample values.
7. Use realistic test data — names, emails, numbers that look plausible.
8. Assertions should be simple checks like:
   - "response contains 'field_name'"
   - "response is not empty"
   - "response is array"
   - "response is object"
"""


def generate_api_test_cases(endpoint_context: str) -> str:
    """Generate positive and negative API test cases for an endpoint using AI."""
    client = _build_client()
    model = _model_name()

    user_msg = (
        "Generate comprehensive positive and negative test cases for "
        "this API endpoint:\n\n" + endpoint_context
    )

    log.info("Generating API test cases via %s model=%s", Config.AI_PROVIDER, model)

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": API_TEST_GENERATION_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=4096,
    )

    text = response.choices[0].message.content or ""
    return _strip_markdown_fences(text)


def _strip_markdown_fences(text: str) -> str:
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def generate_feature(context: str, extra_instructions: str = "") -> str:
    """Send the requirement context to the LLM and return raw .feature text."""
    client = _build_client()
    model = _model_name()

    user_msg = f"Generate a complete Cucumber BDD .feature file from the following requirement:\n\n{context}"
    if extra_instructions:
        user_msg += f"\n\nAdditional instructions:\n{extra_instructions}"

    log.info("Calling %s model=%s  context_len=%d", Config.AI_PROVIDER, model, len(context))

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        text = response.choices[0].message.content or ""
        # #region agent log
        import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:generate_feature:success","message":"api_call_success","data":{"model":model,"response_len":len(text)},"timestamp":int(_time.time()*1000),"hypothesisId":"D"})+"\n"); _lf.close()
        # #endregion
        return _strip_markdown_fences(text)
    except Exception as exc:
        # #region agent log
        import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:generate_feature:error","message":"api_call_failed","data":{"error_type":type(exc).__name__,"error_msg":str(exc),"model":model},"timestamp":int(_time.time()*1000),"hypothesisId":"D"})+"\n"); _lf.close()
        # #endregion
        raise


def generate_test_scenario(context: str, extra_instructions: str = "") -> str:
    """Send the requirement context to the LLM and return a manual test scenario document."""
    client = _build_client()
    model = _model_name()

    user_msg = f"Generate a comprehensive manual test scenario document from the following requirement:\n\n{context}"
    if extra_instructions:
        user_msg += f"\n\nAdditional instructions:\n{extra_instructions}"

    log.info("Calling %s model=%s  context_len=%d (test scenario)", Config.AI_PROVIDER, model, len(context))

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TEST_SCENARIO_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        text = response.choices[0].message.content or ""
        # #region agent log
        import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:generate_test_scenario:success","message":"api_call_success","data":{"model":model,"response_len":len(text)},"timestamp":int(_time.time()*1000),"hypothesisId":"D"})+"\n"); _lf.close()
        # #endregion
        return _strip_markdown_fences(text)
    except Exception as exc:
        # #region agent log
        import json as _json, time as _time; _lf=open("debug-b8a1ae.log","a"); _lf.write(_json.dumps({"sessionId":"b8a1ae","location":"ai_engine.py:generate_test_scenario:error","message":"api_call_failed","data":{"error_type":type(exc).__name__,"error_msg":str(exc),"model":model},"timestamp":int(_time.time()*1000),"hypothesisId":"D"})+"\n"); _lf.close()
        # #endregion
        raise


def generate_smoke_test(context: str, extra_instructions: str = "") -> str:
    """Send the requirement context to the LLM and return a smoke test suite document."""
    client = _build_client()
    model = _model_name()

    user_msg = f"Generate a concise smoke test suite from the following requirement:\n\n{context}"
    if extra_instructions:
        user_msg += f"\n\nAdditional instructions:\n{extra_instructions}"

    log.info("Calling %s model=%s  context_len=%d (smoke test)", Config.AI_PROVIDER, model, len(context))

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SMOKE_TEST_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=4096,
    )

    text = response.choices[0].message.content or ""
    return _strip_markdown_fences(text)
