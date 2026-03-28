import os
from pathlib import Path
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(_env_path, override=True)


class Config:
    AI_PROVIDER = os.getenv("AI_PROVIDER", "cursor")

    CURSOR_API_KEY = os.getenv("CURSOR_API_KEY", "")
    CURSOR_MODEL = os.getenv("CURSOR_MODEL", "claude-3.5-sonnet")

    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")

    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01")

    JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "")
    JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
    JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")

    CONFLUENCE_BASE_URL = os.getenv("CONFLUENCE_BASE_URL", "")
    CONFLUENCE_EMAIL = os.getenv("CONFLUENCE_EMAIL", "")
    CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN", "")

    FIGMA_ACCESS_TOKEN = os.getenv("FIGMA_ACCESS_TOKEN", "")

    FLASK_PORT = int(os.getenv("FLASK_PORT", "5000"))
    OUTPUT_DIR = os.getenv("OUTPUT_DIR", "output")
