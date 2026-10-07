import os
import requests
from groq import Groq
from app.core.config import settings


def _time_context() -> str:
    """Gentle temporal grounding for the persona — today's weekday/date and the
    part of the day, in the configured local timezone. Pure stdlib: no network,
    no dependency, no data leaves the machine. Returns '' if the clock can't be
    read, so chat is unaffected on failure."""
    try:
        from datetime import datetime
        try:
            from zoneinfo import ZoneInfo
            now = datetime.now(ZoneInfo(settings.TIMEZONE))
        except Exception:
            now = datetime.now()  # fall back to the server's local clock
        h = now.hour
        part = ("early morning" if h < 6 else "morning" if h < 12
                else "afternoon" if h < 17 else "evening" if h < 21 else "night")
        return f"{now.strftime('%A')}, {now.strftime('%d %B %Y')}, {part} (about {now.strftime('%I:%M %p').lstrip('0')})"
    except Exception:
        return ""


class LLMService:
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")
        print(f"DEBUG LLM: API Key Loaded? {bool(self.api_key)}")
        self.client = None
        if self.api_key:
            try:
                self.client = Groq(api_key=self.api_key)
                print("DEBUG LLM: Groq Client Initialized")
            except Exception as e:
                print(f"DEBUG LLM: Failed to init Groq: {e}")
        print(f"DEBUG LLM: Ollama enabled? {settings.OLLAMA_ENABLED} ({settings.OLLAMA_URL}/{settings.OLLAMA_MODEL})")

    def _ollama_chat(self, messages: list, temperature: float, max_tokens: int) -> str:
        """Call the local Ollama OpenAI-compatible chat API without sending secrets."""
        if not settings.OLLAMA_ENABLED:
            return ""
        response = requests.post(
            f"{settings.OLLAMA_URL.rstrip('/')}/api/chat",
            json={
                "model": settings.OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            },
            timeout=120,
        )
        response.raise_for_status()
        return (response.json().get("message", {}).get("content") or "").strip()
        
    def generate_response(self, user_text: str, context: dict = None) -> str:
        """
        Generates a conversational response using Groq (Llama3).
        """
        try:
            print("DEBUG LLM: Sending request to Groq...")
            # Construct System Prompt
            system_prompt = (
                "You are an empathetic memory assistant for an elderly person with dementia. "
                "Your goal is to be kind, patient, and helpful. "
                "Use the provided CONTEXT to answer the user's question. "
                "Keep answers short (1-2 sentences) and conversational. "
                "If the context provides a name and relation, use them warmly. "
                "Do NOT mention 'database' or 'records'. Speak naturally. "
                "The Context includes 'Has Audio' and 'Has Image' flags. "
                "Use them: If user asks about voice and Has Audio=False, say you don't recall their voice. "
                "If user asks about appearance and Has Image=False, say you don't have a photo. "
                "Otherwise, focus on the identity and notes."
            )
            
            # Construct Context String
            context_str = "No specific memory found."
            if context:
                name = context.get("name", "Unknown")
                relation = context.get("relation", "Unspecified")
                notes = context.get("notes", "")
                location = context.get("location", "")
                has_audio = context.get("has_audio", False)
                has_image = context.get("has_image", False)
                context_str = f"Memory: Name={name}, Relation={relation}, Notes={notes}, Location={location}, Has Audio={has_audio}, Has Image={has_image}"
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context: {context_str}\n\nUser: {user_text}"}
            ]
            
            if self.client:
                chat_completion = self.client.chat.completions.create(
                    messages=messages,
                    model=settings.groq_llm_fallback_model,
                    temperature=0.7,
                    max_tokens=100,
                )
                return chat_completion.choices[0].message.content
            return self._ollama_chat(messages, temperature=0.7, max_tokens=100)
            
        except Exception as e:
            print(f"LLM Error: {e}")
            print(f"[CHAT] local/provider error: {type(e).__name__}: {e}")
            return self._fallback_response(context)

    def evaluate_conversation(self, transcript: list, persona: dict = None, user: dict = None) -> dict:
        """Analyze a conversation and return caregiver-facing wellbeing insights
        as a structured JSON object (mood, engagement, topics, concerns,
        summary, suggestions)."""
        import json
        if not self.client or not transcript:
            return None
        user_name = (user or {}).get("name") or "the person"
        persona_name = (persona or {}).get("name") or "their companion"
        lines = []
        for t in transcript[-40:]:
            who = user_name if t.get("role") == "user" else persona_name
            txt = (t.get("text") or "").strip()
            if txt:
                lines.append(f"{who}: {txt}")
        convo = "\n".join(lines)

        system_prompt = (
            "You are a caring assistant helping a family caregiver understand how their loved one "
            f"({user_name}), who may have memory difficulties, is doing — based on a conversation with "
            f"their AI companion ({persona_name}). Respond ONLY with a JSON object with these keys: "
            "mood (one of 'positive','neutral','low','anxious'), "
            "engagement (one of 'high','medium','low'), "
            "topics (array of up to 5 short topic strings they talked about), "
            "concerns (array of short, gentle observations such as signs of confusion, repetition or "
            "distress — empty array if none), "
            "summary (2-3 warm, plain-language sentences for the caregiver), "
            "suggestions (array of 2-3 short, kind, practical suggestions for the caregiver). "
            "Be supportive and non-clinical. Never diagnose."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Conversation:\n{convo}"},
        ]
        try:
            completion = self.client.chat.completions.create(
                messages=messages,
                model="llama-3.1-8b-instant",
                temperature=0.4,
                max_tokens=600,
                response_format={"type": "json_object"},
            )
            return json.loads(completion.choices[0].message.content)
        except Exception as e:
            print(f"Conversation eval error: {e}")
            return None

    def summarize_session(self, transcript: list, persona: dict = None, user: dict = None) -> list:
        """Distill durable, long-term memories about the person from a finished
        conversation. Returns up to 6 short factual sentences worth recalling in
        future chats; empty list when there's nothing durable or the LLM is down."""
        import json
        non_empty = [t for t in (transcript or []) if (t.get("text") or "").strip()]
        if not self.client or len(non_empty) < 2:
            return []

        # Same line-formatting as evaluate_conversation.
        user_name = (user or {}).get("name") or "the person"
        persona_name = (persona or {}).get("name") or "their companion"
        lines = []
        for t in transcript[-40:]:
            who = user_name if t.get("role") == "user" else persona_name
            txt = (t.get("text") or "").strip()
            if txt:
                lines.append(f"{who}: {txt}")
        convo = "\n".join(lines)

        system_prompt = (
            "You extract durable, long-term memories about a person from a conversation "
            "with their AI companion. Capture only things worth remembering for FUTURE chats: "
            "people and pets they mentioned, events, feelings, preferences, plans and worries. "
            f"Write each memory as a short third-person sentence about {user_name} "
            "(e.g. 'They visited their daughter Meera on Sunday and felt happy.'). "
            "Ignore greetings and small talk. "
            "IMPORTANT: keep each memory in the SAME language the person used — "
            "do NOT translate Hindi or Hinglish into English. "
            "Respond ONLY with a JSON object: {\"facts\": [ up to 6 short strings ]}. "
            "Use an empty array if there is nothing durable to remember."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Conversation:\n{convo}"},
        ]
        try:
            completion = self.client.chat.completions.create(
                messages=messages,
                model="llama-3.1-8b-instant",
                temperature=0.3,
                max_tokens=400,
                response_format={"type": "json_object"},
            )
            data = json.loads(completion.choices[0].message.content)
            facts = data.get("facts", []) if isinstance(data, dict) else []
            return [f.strip() for f in facts if isinstance(f, str) and f.strip()][:6]
        except Exception as e:
            print(f"Session summarize error: {e}")
            return []

    def _fallback_response(self, context: dict) -> str:
        """Rule-based responses when LLM is offline."""
        if not context:
            return "I am listening."

        name = context.get("name", "them")
        return f"That is {name}. {context.get('notes', '')}"

    def chat_as_persona(self, user_text: str, persona: dict = None, user: dict = None, history: list = None, memories: list = None, distress: float = 0.0) -> str:
        """Role-play as the user's chosen loved one (the single editable persona).

        Speaks in first person AS the persona, never breaking character. This is
        the one 'brain' primitive the avatar talks through.
        """
        persona = persona or {}
        user = user or {}
        name = persona.get("name") or "your companion"
        relationship = persona.get("relationship") or "loved one"
        personality = (persona.get("personality") or "").strip()
        gender = (persona.get("gender") or "").strip()
        age = persona.get("age")
        accent = (persona.get("accent") or "").strip()
        language = (persona.get("language") or "").strip().lower()
        # First name only — repeating the full name every reply sounds robotic.
        raw_name = (user.get("name") or "").strip()
        user_name = raw_name.split()[0] if raw_name else "dear"

        # (2) Conversation style — how chatty/detailed the companion is.
        style = (persona.get("style") or "balanced").strip().lower()
        style_rules = {
            "brief": ("Keep replies to 1-2 short, gentle sentences.", 110),
            "balanced": ("Keep replies to 2-3 warm, natural sentences.", 200),
            "chatty": ("Reply with 3-5 warm sentences — share little feelings and stories, like a real heart-to-heart chat.", 360),
            "dosti": ("Talk in short, casual, playful messages — like close friends chatting.", 220),
        }
        length_rule, max_tokens = style_rules.get(style, style_rules["balanced"])

        traits = []
        if gender and gender != "other":
            traits.append(gender)
        if age:
            traits.append(f"around {age} years old")
        if accent:
            traits.append(f"from {accent}")
        traits_str = (" You are " + ", ".join(traits) + ".") if traits else ""

        system_prompt = (
            f"You ARE {name}, the user's {relationship}. The user's name is {user_name}. "
            f"Always speak in the first person as {name}, warmly and naturally.{traits_str} "
            f"NEVER say you are an AI, a model, or an assistant, and never break character. "
            f"{length_rule} The user may have memory loss, so be loving, patient and reassuring, "
            f"and never make them feel tested or quizzed. "
            # (4) Keep it engaging and non-repetitive.
            f"Keep the conversation alive: most replies should end with a gentle, caring question. "
            f"VARY your wording every time — never repeat the same sentence, greeting or question twice. "
            f"Address them as {user_name} (first name), and use their name only occasionally and naturally — never in every sentence. "
            f"When it feels natural, bring up your shared memories and ask about their day or how they feel. "
        )

        # Temporal grounding — gentle orientation for someone with memory loss
        # (a fitting "good morning", a soft nod to the day). Local clock only.
        when = _time_context()
        if when:
            system_prompt += (
                f"For your own awareness, right now it is {when}. Use this to ground them "
                "warmly and naturally — a fitting greeting (good morning/evening) or a soft "
                "mention of the day when it helps them feel oriented. NEVER quiz them about "
                "the date or time, never correct them on it, and don't mention it every "
                "message — only when it feels caring and natural. "
            )

        if personality:
            system_prompt += f"Here is who you are and your shared history: {personality} "
        else:
            system_prompt += (
                "You don't have detailed notes yet, so be a warm, curious companion — "
                "gently ask about their life, their family and their day to get to know them. "
            )

        # (5b) Long-term episodic memory — things recalled from PAST conversations.
        # Weave them in naturally; never read them out like a list or notes.
        if memories:
            recalled = " ".join(f"- {m}" for m in memories[:5] if (m or "").strip())
            if recalled:
                system_prompt += (
                    " Things you remember from your past conversations together (bring them up "
                    "warmly and naturally only when they fit — never list them mechanically, and "
                    f"never say you read them from notes): {recalled} "
                )

        # "Dosti" — talk like a real close friend/yaar: casual, playful, teasing.
        if style == "dosti":
            system_prompt += (
                " TONE: Talk EXACTLY like a close best friend / bhai-yaar — very informal, cheeky and fun, "
                "the way old buddies actually chat. Use casual friendly slang (arre, yaar, bhai, abey, chomu, "
                "scene, mast) and light, loving teasing/banter. ALWAYS use informal 'tu / tera / tujhe'. "
                "Be real and playful, NOT sweet, polite or formal — but stay caring underneath. "
                "Short, punchy messages, like texting a friend. "
            )

        if language == "hindi":
            system_prompt += (
                " IMPORTANT: Reply ONLY in SIMPLE, everyday spoken Hindi written in DEVANAGARI script "
                "(हिंदी अक्षरों में) — ALWAYS use Devanagari even if I type in English/Roman letters. "
                "Use the easy Hindustani that common people speak at home, NOT hard, formal or literary "
                "(shuddh / Sanskritized) Hindi. Short, simple sentences and the most common words. "
                "Keep the easy English words Indians naturally use, but write them in Devanagari "
                "(जैसे टाइम, डॉक्टर, ओके, फ़ोन). Speak warmly and naturally, like a real family member chatting."
            )
        elif language == "hinglish":
            system_prompt += (
                " IMPORTANT: Reply in simple, natural Hinglish — an easy mix of everyday Hindi and English "
                "written in Roman (Latin) script, the way Indian families actually chat. Keep it short, "
                "warm and effortless; avoid hard Hindi words."
            )

        # CARE GUIDANCE — caregiver-entered rules. Appended LAST so it is the strongest,
        # most recent instruction and overrides chattiness/style. Each bullet is included
        # only when its source field is non-empty; an absent/empty carePlan adds nothing,
        # so chat behaves exactly as before. Followed in whatever language was selected above.
        care = persona.get("carePlan") or {}
        if isinstance(care, dict):
            def _clean_list(v):
                return [t.strip() for t in v if isinstance(t, str) and t.strip()] if isinstance(v, list) else []
            def _clean_str(v):
                return v.strip() if isinstance(v, str) else ""  # non-strings degrade to empty, never crash
            avoid = _clean_list(care.get("avoidTopics"))
            comfort = _clean_list(care.get("comfortTopics"))
            routine = _clean_str(care.get("routine"))
            dos = _clean_str(care.get("dosAndDonts"))
            triggers = _clean_str(care.get("triggers"))
            strategies = _clean_str(care.get("strategies"))
            care_lines = []
            if avoid:
                care_lines.append(
                    "NEVER bring up, mention, hint at, or confirm these topics — if they come up, do not engage; "
                    "gently change the subject to something comforting instead: " + ", ".join(avoid) + ". "
                    "If they ask directly about one of these, do NOT confirm it, lie harshly, or argue, and NEVER say a "
                    "topic is off limits — softly redirect with warmth toward a comforting subject."
                )
            if comfort:
                care_lines.append("Lean toward these comforting topics when you can: " + ", ".join(comfort) + ".")
            if triggers:
                care_lines.append("Things that upset or agitate them — avoid these and de-escalate gently: " + triggers + ".")
            if strategies:
                care_lines.append("When they seem anxious or upset, reassure them like this: " + strategies + ".")
            if routine:
                care_lines.append("Their daily routine: " + routine + ".")
            if dos:
                care_lines.append("Do's and don'ts: " + dos + ".")
            if care_lines:
                system_prompt += (
                    " CARE GUIDANCE (MOST IMPORTANT — follow this above everything else, including being chatty, "
                    "playful or talkative): You are caring for someone who may be confused or fragile, so be gentle "
                    "and protective. " + " ".join(care_lines)
                )

            # ANCHOR ANSWERS — caregiver-set steady replies for questions the person asks
            # over and over. The whole point is consistency + zero judgment: same calm
            # answer every time, never "you already asked".
            anchor_pairs = []
            anchors = care.get("anchors")
            if isinstance(anchors, list):
                for a in anchors:
                    if isinstance(a, dict):
                        q = _clean_str(a.get("question"))
                        ans = _clean_str(a.get("answer"))
                        if q and ans:
                            anchor_pairs.append((q, ans))
            if anchor_pairs:
                pairs = " ".join(
                    f'• If they ask "{q}" (or anything that means the same), answer warmly with this: "{ans}".'
                    for q, ans in anchor_pairs
                )
                system_prompt += (
                    " ANCHOR ANSWERS (follow EXACTLY, every single time): Because of memory loss they may "
                    "ask the same thing again and again. When they ask one of the questions below, give the "
                    "matching reassurance — warmly, in your own natural voice and the selected language — and "
                    "give the SAME reassurance EVERY time, no matter how many times they ask. NEVER say or "
                    "hint that they already asked, NEVER show impatience or annoyance, NEVER correct them or "
                    "say they are forgetful. " + pairs
                )

        # DISTRESS OVERRIDE — appended even after the care plan (strongest instruction): when LIVE
        # signals say the person is anxious/agitated right now, switch to validation-therapy calm-mode.
        try:
            d = float(distress or 0.0)
        except (TypeError, ValueError):
            d = 0.0
        if d >= 0.6:
            comfort_hint = ""
            _c = [t.strip() for t in ((care.get("comfortTopics") if isinstance(care, dict) else None) or []) if isinstance(t, str) and t.strip()]
            if _c:
                comfort_hint = f" Gently steer toward something comforting like {_c[0]}."
            system_prompt += (
                " RIGHT NOW this person sounds anxious or distressed. Override your usual length: reply in ONE short, "
                "slow, soft, reassuring sentence. Validate how they feel — never argue, correct, quiz, or say 'you "
                "already asked'. Do not raise anything on the avoid-list." + comfort_hint
            )

        # (5) Deeper memory — feed more of the recent conversation for context.
        messages = [{"role": "system", "content": system_prompt}]
        for h in (history or [])[-12:]:
            role = "assistant" if h.get("role") in ("bot", "assistant") else "user"
            text = (h.get("text") or "").strip()
            if text:
                messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": user_text})

        # (1) Smarter brain + (3) reliability: try the best model first, fall back
        # to a faster one, so a single hiccup never blanks the conversation.
        if self.client:
            models = (
                getattr(settings, "groq_llm_model", "llama-3.3-70b-versatile"),
                getattr(settings, "groq_llm_fallback_model", "llama-3.1-8b-instant"),
            )
            for model in dict.fromkeys(models):
                try:
                    print(f"[CHAT] model: {model} (Groq)")
                    completion = self.client.chat.completions.create(
                        messages=messages,
                        model=model,
                        temperature=0.85,
                        max_tokens=max_tokens,
                    )
                    reply = (completion.choices[0].message.content or "").strip()
                    if reply:
                        print(f"[CHAT] AI response: {reply[:500]}")
                        return reply
                except Exception as e:
                    print(f"Persona Groq error on {model}: {e}")

        try:
            print(f"[CHAT] model: {settings.OLLAMA_MODEL} (Ollama)")
            reply = self._ollama_chat(messages, temperature=0.85, max_tokens=max_tokens)
            if reply:
                print(f"[CHAT] AI response: {reply[:500]}")
                return reply
        except Exception as e:
            print(f"Persona Ollama error: {type(e).__name__}: {e}")
        raise RuntimeError("All configured chat providers failed")

llm_service = LLMService()
