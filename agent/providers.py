"""
BugHunter.AI - LLM Provider Factory
Supports Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama.
Configure via LLM_PROVIDER and LLM_MODEL env vars.
"""

import os
import logging

logger = logging.getLogger("bughunter.providers")

# Default models per provider
DEFAULT_MODELS = {
    "anthropic": "claude-3-5-sonnet-20241022",
    "openai":    "gpt-4o",
    "google":    "gemini-2.0-flash",
    "groq":      "llama-3.3-70b-versatile",
    "mistral":   "mistral-large-latest",
    "ollama":    "llama3",
}

def get_llm(provider: str = None, model: str = None, temperature: float = 0.2):
    """
    Return a LangChain chat model for the given provider.
    Falls back to LLM_PROVIDER / LLM_MODEL env vars, then defaults to Anthropic.
    """
    provider = (provider or os.getenv("LLM_PROVIDER", "anthropic")).lower()
    model = model or os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider)

    logger.info(f"Initializing LLM: provider={provider}, model={model}")

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model,
            api_key=os.environ["ANTHROPIC_API_KEY"],
            temperature=temperature,
        )

    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            api_key=os.environ["OPENAI_API_KEY"],
            temperature=temperature,
        )

    elif provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model,
            google_api_key=os.environ["GOOGLE_API_KEY"],
            temperature=temperature,
        )

    elif provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            model=model,
            api_key=os.environ["GROQ_API_KEY"],
            temperature=temperature,
        )

    elif provider == "mistral":
        from langchain_mistralai import ChatMistralAI
        return ChatMistralAI(
            model=model,
            api_key=os.environ["MISTRAL_API_KEY"],
            temperature=temperature,
        )

    elif provider == "ollama":
        from langchain_community.chat_models import ChatOllama
        return ChatOllama(
            model=model,
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            temperature=temperature,
        )

    else:
        raise ValueError(
            f"Unsupported LLM_PROVIDER: '{provider}'. "
            f"Supported: anthropic, openai, google, groq, mistral, ollama"
        )
