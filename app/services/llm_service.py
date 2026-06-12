import os
from groq import Groq
from app.core.config import settings

class LLMService:
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")
        print(f"DEBUG LLM: API Key Loaded? {bool(self.api_key)}")
        if self.api_key:
             print(f"DEBUG LLM: Key starts with {self.api_key[:4]}...")
        
        self.client = None
        if self.api_key:
            try:
                self.client = Groq(api_key=self.api_key)
                print("DEBUG LLM: Groq Client Initialized")
            except Exception as e:
                print(f"DEBUG LLM: Failed to init Groq: {e}")
        
    def generate_response(self, user_text: str, context: dict = None) -> str:
        """
        Generates a conversational response using Groq (Llama3).
        """
        if not self.client:
            print("DEBUG LLM: No Client, using Fallback")
            return self._fallback_response(context)
            
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
            
            chat_completion = self.client.chat.completions.create(
                messages=messages,
                model="llama-3.1-8b-instant",
                temperature=0.7,
                max_tokens=100,
            )
            
            return chat_completion.choices[0].message.content
            
        except Exception as e:
            print(f"LLM Error: {e}")
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

    def _fallback_response(self, context: dict) -> str:
        """Rule-based responses when LLM is offline."""
        if not context:
            return "I am listening."

        name = context.get("name", "them")
        return f"That is {name}. {context.get('notes', '')}"

    def chat_as_persona(self, user_text: str, persona: dict = None, user: dict = None, history: list = None) -> str:
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
        user_name = user.get("name") or "dear"

        if not self.client:
            return f"I'm right here with you, {user_name}."

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
            f"Keep replies short (1-3 sentences), loving, patient and reassuring — the user "
            f"may have memory loss, so be gentle and never make them feel tested. "
        )
        if personality:
            system_prompt += f"Here is who you are and your shared history: {personality} "

        if language == "hindi":
            system_prompt += (
                " IMPORTANT: Reply ONLY in natural, conversational Hindi written in Devanagari script. "
                "Do not use English except for words Indians normally say in English."
            )
        elif language == "hinglish":
            system_prompt += (
                " IMPORTANT: Reply in natural Hinglish — a casual mix of Hindi and English written in Roman "
                "(Latin) script, the way Indian friends actually text each other."
            )

        messages = [{"role": "system", "content": system_prompt}]
        for h in (history or [])[-6:]:
            role = "assistant" if h.get("role") in ("bot", "assistant") else "user"
            text = (h.get("text") or "").strip()
            if text:
                messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": user_text})

        try:
            completion = self.client.chat.completions.create(
                messages=messages,
                model="llama-3.1-8b-instant",
                temperature=0.8,
                max_tokens=160,
            )
            return completion.choices[0].message.content
        except Exception as e:
            print(f"Persona LLM error: {e}")
            return f"I'm right here with you, {user_name}."

llm_service = LLMService()
