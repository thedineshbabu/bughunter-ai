"""
BugHunter.AI - Claude CLI Chat Model Wrapper
Wraps `claude -p` CLI as a LangChain BaseChatModel.
Allows using Claude Code (SSO/browser auth) without ANTHROPIC_API_KEY.
"""
import logging
import subprocess
from typing import Any, List, Optional

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

logger = logging.getLogger("bughunter.claude_cli")


class ChatClaudeCLI(BaseChatModel):
    """LangChain BaseChatModel that delegates to the `claude` CLI subprocess.

    Use when Claude Code is installed and authenticated via SSO or browser auth.
    Note: temperature is not forwarded — the `claude -p` CLI does not expose it.

    Env vars:
        LLM_PROVIDER=claude_cli
        LLM_MODEL=claude-sonnet-4-6      # optional, this is the default
        CLAUDE_CLI_TIMEOUT=300            # optional, seconds
    """

    model: str = "claude-sonnet-4-6"
    timeout: int = 300

    @property
    def _llm_type(self) -> str:
        return "claude_cli"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {"model": self.model, "timeout": self.timeout}

    @staticmethod
    def _messages_to_prompt(messages: List[BaseMessage]) -> str:
        """Convert LangChain messages to a single prompt string for the CLI."""
        parts: list[str] = []
        for msg in messages:
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            msg_type = getattr(msg, "type", "")
            if msg_type == "system":
                parts.append(f"[SYSTEM]: {content}\n")
            elif msg_type == "human":
                parts.append(content)
            elif msg_type == "ai":
                parts.append(f"[ASSISTANT]: {content}\n")
            else:
                parts.append(f"[{msg_type.upper()}]: {content}\n")
        return "\n".join(parts)

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        prompt = self._messages_to_prompt(messages)
        cmd = ["claude", "--model", self.model, "-p", prompt]
        logger.debug(f"Invoking claude CLI: model={self.model}, prompt_len={len(prompt)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            raise RuntimeError(
                "claude CLI not found on PATH. Install Claude Code and ensure "
                "the `claude` binary is accessible."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"claude CLI timed out after {self.timeout}s. "
                "Increase CLAUDE_CLI_TIMEOUT if needed."
            )

        if result.returncode != 0:
            raise RuntimeError(
                f"claude CLI exited with code {result.returncode}. "
                f"stderr: {result.stderr.strip()}"
            )

        message = AIMessage(content=result.stdout.strip())
        return ChatResult(generations=[ChatGeneration(message=message)])
