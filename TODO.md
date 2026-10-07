# TODO — Fix AI chat not answering correctly

## Root cause
The chat flow uses a deprecated Groq model ID (`llama3-70b-8192`) that Groq
no longer serves. When the model call fails, the code silently falls back to a
canned template reply instead of actually answering.

## Steps
- [x] Investigate chat architecture (chat_endpoint, memory_agent, groq_service, llm_service, persona_endpoint)
- [x] Confirm root cause: deprecated model ID in `app/config.py`
- [x] Fix deprecated model ID -> current valid Groq model in `app/config.py`
- [x] Add model-fallback chain in `app/services/groq_service.py::chat()` (like `llm_service.chat_as_persona`)
- [x] Verify both files compile (py_compile -> COMPILE_OK)
- [ ] Restart backend and test chat endpoint
