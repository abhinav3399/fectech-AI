"""Chat quality tests: role formatting, history de-duplication, label leakage."""
import pytest

from app.core.config import settings
from app.services.llm_service import LLMService, build_conversation, sanitize_reply


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("User: Hello there.", "Hello there."),
        ("Assistant: Hello", "Hello"),
        ("Assistant: Assistant: Hello there.", "Hello there."),
        ("User: User: Time assistant User: Abhinav, Task Assistant.", ""),
        ("I am here. I am here. How are you?", "I am here. How are you?"),
        ("", ""),
    ],
)
def test_sanitize_reply_removes_template_leakage(raw, expected):
    assert sanitize_reply(raw) == expected


def test_build_conversation_keeps_roles_separate_and_dedupes():
    history = [
        {"role": "user", "text": "Hi"},
        {"role": "bot", "text": "Hello"},
        {"role": "bot", "text": "Hello"},
        {"role": "user", "text": ""},
        {"role": "user", "text": "What time is it?"},
    ]
    messages = build_conversation("SYSTEM", history, "What time is it?")

    assert messages[0] == {"role": "system", "content": "SYSTEM"}
    assert all("User:" not in m["content"] and "Assistant:" not in m["content"] for m in messages)
    assert messages[-1] == {"role": "user", "content": "What time is it?"}
    assert sum(1 for m in messages if m["content"] == "What time is it?") == 1
    assert sum(1 for m in messages if m["content"] == "Hello") == 1
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]


def test_history_does_not_duplicate_current_user_turn():
    history = [{"role": "user", "text": "Hi"}]
    messages = build_conversation("SYSTEM", history, "Hi")
    assert len([m for m in messages if m["content"] == "Hi"]) == 1
    assert messages[-1]["role"] == "user"


def test_local_model_is_preferred_and_reply_is_sanitized(monkeypatch):
    service = object.__new__(LLMService)
    service.client = object()  # pretend a cloud client exists
    calls = []

    def local(messages, max_tokens):
        calls.append("local")
        return "Assistant: Hello Abhinav, how are you?"

    def cloud(messages, max_tokens):
        calls.append("cloud")
        return "Cloud reply"

    service._call_local = local
    service._call_cloud = cloud
    monkeypatch.setattr(LLMService, "local_first", property(lambda self: True))

    reply = service.chat_as_persona(
        "Hi",
        persona={"name": "Dad", "relationship": "father", "language": "English"},
        user={"name": "Abhinav Panwar"},
        history=[],
    )

    assert calls == ["local"]
    assert reply == "Hello Abhinav, how are you?"
    assert not reply.startswith("Assistant")


def test_cloud_is_used_when_local_fails(monkeypatch):
    service = object.__new__(LLMService)
    service.client = object()
    calls = []

    def local(messages, max_tokens):
        calls.append("local")
        raise RuntimeError("Ollama down")

    def cloud(messages, max_tokens):
        calls.append("cloud")
        return "From the cloud"

    service._call_local = local
    service._call_cloud = cloud
    monkeypatch.setattr(LLMService, "local_first", property(lambda self: True))

    reply = service.chat_as_persona("Hello", persona={"name": "Dad"}, user={"name": "Abhinav"}, history=[])
    assert calls == ["local", "cloud"]
    assert reply == "From the cloud"


def test_no_provider_failing_raises_instead_of_inventing(monkeypatch):
    service = object.__new__(LLMService)
    service.client = None

    def local(messages, max_tokens):
        raise RuntimeError("down")

    def cloud(messages, max_tokens):
        raise RuntimeError("down")

    service._call_local = local
    service._call_cloud = cloud
    monkeypatch.setattr(LLMService, "local_first", property(lambda self: True))

    with pytest.raises(RuntimeError):
        service.chat_as_persona("Hello", persona={"name": "Dad"}, user={"name": "Abhinav"}, history=[])


def test_cloud_disabled_never_constructs_a_cloud_client(monkeypatch):
    monkeypatch.setattr(settings, "CLOUD_AI_ENABLED", False)
    monkeypatch.setattr(settings, "GROQ_API_KEY", "not-a-real-key")
    service = LLMService()
    assert service.client is None
    assert service.provider_status()["cloud"]["configured"] is False


def test_severe_label_leak_is_rejected_not_displayed(monkeypatch):
    service = object.__new__(LLMService)
    service.client = object()

    def local(messages, max_tokens):
        return "User: User: Time assistant User: Abhinav Panwar, Task Assistant."

    def cloud(messages, max_tokens):
        raise RuntimeError("cloud unavailable")

    service._call_local = local
    service._call_cloud = cloud
    monkeypatch.setattr(LLMService, "local_first", property(lambda self: True))

    with pytest.raises(RuntimeError):
        service.chat_as_persona("Hi", persona={"name": "Dad"}, user={"name": "Abhinav"}, history=[])


def test_chat_prompt_keeps_user_name_out_of_each_history_turn(monkeypatch):
    service = object.__new__(LLMService)
    service.client = object()
    captured = {}

    def local(messages, max_tokens):
        captured["messages"] = messages
        return "Hello."

    service._call_local = local
    service._call_cloud = lambda *_: "cloud"
    monkeypatch.setattr(LLMService, "local_first", property(lambda self: True))

    service.chat_as_persona(
        "What should I do today?",
        persona={"name": "Dad", "relationship": "father"},
        user={"name": "Abhinav Panwar"},
        history=[{"role": "user", "text": "Hi"}, {"role": "bot", "text": "Hello"}],
        memories=["They like tea."],
    )

    messages = captured["messages"]
    assert messages[0]["role"] == "system"
    assert "Abhinav" in messages[0]["content"]
    user_turns = [m for m in messages if m["role"] == "user"]
    assert all("Abhinav" not in m["content"] for m in user_turns)
    assert user_turns[-1]["content"] == "What should I do today?"
