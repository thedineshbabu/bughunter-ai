"""API / Automated Test Runner.

Accepts a local repository path or a Git URL, auto-detects the test framework,
discovers test files, and executes them — streaming progress via a callback.

Supported frameworks:
  - Python:  pytest, unittest
  - JS/TS:   jest, mocha, vitest
  - API:     newman (Postman collections)
  - Java:    maven (JUnit / TestNG)
  - .NET:    dotnet test
  - Go:      go test
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger(__name__)

CLONE_DIR = Path(tempfile.gettempdir()) / "qa_oneshop_repos"


@dataclass
class DetectedFramework:
    name: str
    display_name: str
    command: str
    config_file: str = ""
    test_files: list[str] = field(default_factory=list)
    confidence: str = "high"  # high | medium | low


@dataclass
class TestResult:
    total: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0
    duration_ms: int = 0
    output: str = ""
    framework: str = ""
    exit_code: int = 0


def _is_git_url(value: str) -> bool:
    value = value.strip()
    return (
        value.startswith("http://")
        or value.startswith("https://")
        or value.startswith("git@")
        or value.endswith(".git")
    )


def resolve_repo_path(repo_input: str, on_progress: Optional[Callable] = None) -> Path:
    """Return a local Path to the repository, cloning if needed."""
    repo_input = repo_input.strip()

    if _is_git_url(repo_input):
        repo_name = repo_input.rstrip("/").split("/")[-1].replace(".git", "")
        dest = CLONE_DIR / repo_name
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)

        CLONE_DIR.mkdir(parents=True, exist_ok=True)

        if on_progress:
            on_progress("log", f"Cloning {repo_input} ...")

        result = subprocess.run(
            ["git", "clone", "--depth", "1", repo_input, str(dest)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git clone failed: {result.stderr.strip()}")

        if on_progress:
            on_progress("log", f"Cloned to {dest}")
        return dest

    path = Path(repo_input)
    if not path.exists():
        raise FileNotFoundError(f"Path does not exist: {repo_input}")
    if not path.is_dir():
        raise NotADirectoryError(f"Not a directory: {repo_input}")
    return path


def _glob_count(base: Path, pattern: str) -> list[str]:
    """Return relative paths matching a glob, capped at 200."""
    matches = []
    for p in base.rglob(pattern):
        rel = str(p.relative_to(base)).replace("\\", "/")
        if "node_modules" in rel or ".git" in rel or "__pycache__" in rel:
            continue
        matches.append(rel)
        if len(matches) >= 200:
            break
    return matches


def detect_frameworks(repo_path: Path) -> list[DetectedFramework]:
    """Scan a repository and return detected test frameworks."""
    detected: list[DetectedFramework] = []

    # -- Python: pytest --
    py_test_files = _glob_count(repo_path, "test_*.py") + _glob_count(repo_path, "*_test.py")
    conftest = (repo_path / "conftest.py").exists()
    pytest_ini = (repo_path / "pytest.ini").exists()
    pyproject = (repo_path / "pyproject.toml").exists()
    setup_cfg = (repo_path / "setup.cfg").exists()

    has_requirements = (repo_path / "requirements.txt").exists()

    if py_test_files or conftest or pytest_ini:
        config = "pytest.ini" if pytest_ini else ("pyproject.toml" if pyproject else "")
        detected.append(DetectedFramework(
            name="pytest",
            display_name="Python — pytest",
            command="pytest -v --tb=short --no-header -q",
            config_file=config,
            test_files=py_test_files[:50],
            confidence="high" if (pytest_ini or conftest) else "medium",
        ))

    # -- Python: unittest (fallback if no pytest markers) --
    if py_test_files and not conftest and not pytest_ini:
        detected.append(DetectedFramework(
            name="unittest",
            display_name="Python — unittest",
            command="python -m unittest discover -v",
            test_files=py_test_files[:50],
            confidence="low",
        ))

    # -- JavaScript / TypeScript --
    pkg_json_path = repo_path / "package.json"
    if pkg_json_path.exists():
        try:
            pkg = json.loads(pkg_json_path.read_text(encoding="utf-8"))
        except Exception:
            pkg = {}

        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        scripts = pkg.get("scripts", {})

        # Jest
        if "jest" in deps or "jest" in pkg:
            js_test_files = (
                _glob_count(repo_path, "*.test.js")
                + _glob_count(repo_path, "*.test.ts")
                + _glob_count(repo_path, "*.test.tsx")
                + _glob_count(repo_path, "*.spec.js")
                + _glob_count(repo_path, "*.spec.ts")
            )
            detected.append(DetectedFramework(
                name="jest",
                display_name="JavaScript — Jest",
                command="npx jest --verbose --no-coverage",
                config_file="package.json",
                test_files=js_test_files[:50],
                confidence="high",
            ))

        # Mocha
        if "mocha" in deps:
            mocha_files = _glob_count(repo_path, "*.test.js") + _glob_count(repo_path, "*.spec.js")
            detected.append(DetectedFramework(
                name="mocha",
                display_name="JavaScript — Mocha",
                command="npx mocha --recursive --reporter spec",
                config_file="package.json",
                test_files=mocha_files[:50],
                confidence="high",
            ))

        # Vitest
        if "vitest" in deps:
            vt_files = (
                _glob_count(repo_path, "*.test.ts")
                + _glob_count(repo_path, "*.test.js")
                + _glob_count(repo_path, "*.spec.ts")
            )
            detected.append(DetectedFramework(
                name="vitest",
                display_name="JavaScript — Vitest",
                command="npx vitest run --reporter=verbose",
                config_file="package.json",
                test_files=vt_files[:50],
                confidence="high",
            ))

        # Generic npm test fallback
        if "test" in scripts and not detected:
            detected.append(DetectedFramework(
                name="npm_test",
                display_name="npm test (generic)",
                command="npm test",
                config_file="package.json",
                test_files=[],
                confidence="medium",
            ))

    # -- Newman / Postman --
    postman_files = _glob_count(repo_path, "*.postman_collection.json")
    if postman_files:
        detected.append(DetectedFramework(
            name="newman",
            display_name="API — Newman (Postman)",
            command="npx newman run",
            test_files=postman_files[:20],
            confidence="high",
        ))

    # -- Java: Maven --
    if (repo_path / "pom.xml").exists():
        java_tests = _glob_count(repo_path, "*Test.java") + _glob_count(repo_path, "*Tests.java")
        detected.append(DetectedFramework(
            name="maven",
            display_name="Java — Maven (JUnit / TestNG)",
            command="mvn test -B",
            config_file="pom.xml",
            test_files=java_tests[:50],
            confidence="high",
        ))

    # -- Java: Gradle --
    if (repo_path / "build.gradle").exists() or (repo_path / "build.gradle.kts").exists():
        java_tests = _glob_count(repo_path, "*Test.java") + _glob_count(repo_path, "*Tests.java")
        detected.append(DetectedFramework(
            name="gradle",
            display_name="Java — Gradle",
            command="gradle test",
            config_file="build.gradle",
            test_files=java_tests[:50],
            confidence="high",
        ))

    # -- .NET --
    csproj_files = _glob_count(repo_path, "*.csproj")
    sln_files = _glob_count(repo_path, "*.sln")
    if csproj_files or sln_files:
        cs_tests = _glob_count(repo_path, "*Tests.cs") + _glob_count(repo_path, "*Test.cs")
        detected.append(DetectedFramework(
            name="dotnet",
            display_name=".NET — dotnet test",
            command="dotnet test --verbosity normal",
            config_file=sln_files[0] if sln_files else (csproj_files[0] if csproj_files else ""),
            test_files=cs_tests[:50],
            confidence="high",
        ))

    # -- Go --
    go_tests = _glob_count(repo_path, "*_test.go")
    if go_tests:
        detected.append(DetectedFramework(
            name="go",
            display_name="Go — go test",
            command="go test -v ./...",
            test_files=go_tests[:50],
            confidence="high",
        ))

    # -- Robot Framework --
    robot_files = _glob_count(repo_path, "*.robot")
    if robot_files:
        detected.append(DetectedFramework(
            name="robot",
            display_name="Robot Framework",
            command="robot --outputdir output .",
            test_files=robot_files[:50],
            confidence="high",
        ))

    return detected


def _parse_pytest_output(output: str) -> TestResult:
    """Extract counts from pytest summary line."""
    result = TestResult(framework="pytest", output=output)
    m = re.search(r"(\d+) passed", output)
    if m:
        result.passed = int(m.group(1))
    m = re.search(r"(\d+) failed", output)
    if m:
        result.failed = int(m.group(1))
    m = re.search(r"(\d+) error", output)
    if m:
        result.errors = int(m.group(1))
    m = re.search(r"(\d+) skipped", output)
    if m:
        result.skipped = int(m.group(1))
    m = re.search(r"in ([\d.]+)s", output)
    if m:
        result.duration_ms = int(float(m.group(1)) * 1000)
    result.total = result.passed + result.failed + result.errors + result.skipped
    return result


def _parse_jest_output(output: str) -> TestResult:
    result = TestResult(framework="jest", output=output)
    m = re.search(r"Tests:\s+(?:(\d+) failed,?\s*)?(?:(\d+) skipped,?\s*)?(?:(\d+) passed,?\s*)?(\d+) total", output)
    if m:
        result.failed = int(m.group(1) or 0)
        result.skipped = int(m.group(2) or 0)
        result.passed = int(m.group(3) or 0)
        result.total = int(m.group(4) or 0)
    m = re.search(r"Time:\s+([\d.]+)\s*s", output)
    if m:
        result.duration_ms = int(float(m.group(1)) * 1000)
    return result


def _parse_generic_output(output: str, framework: str) -> TestResult:
    result = TestResult(framework=framework, output=output)
    for pattern in [r"(\d+)\s+(?:tests?\s+)?passed", r"(\d+)\s+passing"]:
        m = re.search(pattern, output, re.IGNORECASE)
        if m:
            result.passed = int(m.group(1))
            break
    for pattern in [r"(\d+)\s+(?:tests?\s+)?failed", r"(\d+)\s+failing"]:
        m = re.search(pattern, output, re.IGNORECASE)
        if m:
            result.failed = int(m.group(1))
            break
    for pattern in [r"(\d+)\s+(?:tests?\s+)?skipped", r"(\d+)\s+pending"]:
        m = re.search(pattern, output, re.IGNORECASE)
        if m:
            result.skipped = int(m.group(1))
            break
    result.total = result.passed + result.failed + result.skipped + result.errors
    return result


def run_tests(
    repo_path: Path,
    framework: DetectedFramework,
    custom_command: str = "",
    on_progress: Optional[Callable] = None,
) -> TestResult:
    """Execute tests and return a TestResult.

    Args:
        repo_path: Root of the repository.
        framework: Detected framework descriptor.
        custom_command: Override the auto-detected command.
        on_progress: ``(event_type, data)`` callback for streaming.
    """
    def _emit(event_type: str, data):
        if on_progress:
            try:
                on_progress(event_type, data)
            except Exception:
                pass

    command = custom_command.strip() if custom_command else framework.command

    # Newman needs to be called once per collection file
    if framework.name == "newman" and not custom_command:
        return _run_newman(repo_path, framework, on_progress)

    _emit("log", f"Running: {command}")
    _emit("log", f"Working directory: {repo_path}")

    start = time.perf_counter()

    env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            cwd=str(repo_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
        )
    except Exception as exc:
        _emit("log", f"Failed to start process: {exc}")
        return TestResult(framework=framework.name, output=str(exc), exit_code=1)

    output_lines: list[str] = []
    for line in iter(proc.stdout.readline, ""):
        line = line.rstrip("\n")
        output_lines.append(line)
        _emit("output", line)

    proc.wait()
    elapsed = int((time.perf_counter() - start) * 1000)
    full_output = "\n".join(output_lines)

    _emit("log", f"Process exited with code {proc.returncode} in {elapsed}ms")

    if framework.name == "pytest":
        result = _parse_pytest_output(full_output)
    elif framework.name in ("jest", "vitest"):
        result = _parse_jest_output(full_output)
    else:
        result = _parse_generic_output(full_output, framework.name)

    result.exit_code = proc.returncode
    result.duration_ms = elapsed
    result.output = full_output

    if result.total == 0 and proc.returncode == 0:
        result.passed = 1
        result.total = 1

    _emit("complete", {
        "total": result.total,
        "passed": result.passed,
        "failed": result.failed,
        "skipped": result.skipped,
        "errors": result.errors,
        "duration_ms": result.duration_ms,
        "exit_code": result.exit_code,
    })

    return result


def _run_newman(
    repo_path: Path,
    framework: DetectedFramework,
    on_progress: Optional[Callable] = None,
) -> TestResult:
    """Run newman for each discovered Postman collection."""
    def _emit(event_type: str, data):
        if on_progress:
            try:
                on_progress(event_type, data)
            except Exception:
                pass

    combined = TestResult(framework="newman")
    all_output: list[str] = []
    start = time.perf_counter()

    for coll_file in framework.test_files:
        coll_path = repo_path / coll_file
        cmd = f"npx newman run \"{coll_path}\" --reporters cli"
        _emit("log", f"Running collection: {coll_file}")

        env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}
        try:
            proc = subprocess.Popen(
                cmd, shell=True, cwd=str(repo_path),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, env=env, bufsize=1,
            )
        except Exception as exc:
            _emit("log", f"Failed to start newman: {exc}")
            continue

        for line in iter(proc.stdout.readline, ""):
            line = line.rstrip("\n")
            all_output.append(line)
            _emit("output", line)

        proc.wait()
        partial = _parse_generic_output("\n".join(all_output), "newman")
        combined.passed += partial.passed
        combined.failed += partial.failed
        combined.skipped += partial.skipped
        if proc.returncode != 0:
            combined.exit_code = proc.returncode

    combined.duration_ms = int((time.perf_counter() - start) * 1000)
    combined.total = combined.passed + combined.failed + combined.skipped
    combined.output = "\n".join(all_output)

    _emit("complete", {
        "total": combined.total,
        "passed": combined.passed,
        "failed": combined.failed,
        "skipped": combined.skipped,
        "errors": combined.errors,
        "duration_ms": combined.duration_ms,
        "exit_code": combined.exit_code,
    })

    return combined
