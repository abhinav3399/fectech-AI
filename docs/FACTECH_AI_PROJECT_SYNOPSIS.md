# PROJECT SYNOPSIS

## Factech AI: Privacy-First AI Memory Companion for Dementia Care

Submitted in partial fulfillment of the requirements for the degree of

**MASTER OF COMPUTER APPLICATIONS**

**Submitted By:**  
[Student Name]  
[Enrollment Number]

**Under the Supervision of:**  
[Supervisor Name]  
[Designation]

**Department:**  
[Department Name]

**Institution:**  
[University / College Name]

**Session:**  
2026 - 2027

---

## INDEX

1. Abstract
2. Introduction
3. Literature Review
4. Problem Statement and Objectives
5. Hypothesis and Methodology
6. Results
7. Conclusion and Future Work
8. References

---

## 1. Abstract

Factech AI is a privacy-first, multimodal artificial intelligence memory companion designed to support people living with dementia and Alzheimer's disease. Memory loss can make it difficult for a person to recognise loved ones, remember daily routines, communicate confidently, and remain emotionally connected when family members are not physically present. Conventional reminder applications and generic chatbots provide information, but they usually do not offer the familiarity, warmth, and continuity that are important in dementia care.

The proposed system allows a caregiver to create a digital companion based on a real loved one. The caregiver can provide the person's name, relationship, personality, language, shared memories, photograph, and optional voice sample. The companion then communicates in a warm and patient manner through text and voice. Factech AI can display a real photograph, an animated talking photograph, or a three-dimensional face generated from a photograph. Lip movement is synchronised with speech to create a more natural and recognisable interaction.

The system combines an AI persona conversation engine, long-term episodic memory, face recognition, personal-object recognition, reminders, medication support, family contacts, caregiver wellbeing insights, and emergency communication. It supports English, Hindi, and Hinglish interactions. The caregiver can also define a private care plan containing comfort topics, topics to avoid, routines, triggers, and calming strategies. This information guides the companion's responses without exposing the care plan to the patient.

The application is implemented using React and Vite for the user interface, Capacitor for Android packaging, FastAPI for the backend services, Qdrant for vector-based memory and recognition, MediaPipe and computer-vision components for face and avatar processing, and local voice engines including OpenVoice and XTTS where available. The Android application also includes local-first state persistence through Capacitor SQLite and an optional cached offline AI mode. The system is intended to improve familiarity, emotional comfort, routine support, and caregiver awareness while respecting privacy, dignity, and user consent.

**Keywords:** Dementia care, Alzheimer's support, artificial intelligence, digital companion, face recognition, voice cloning, episodic memory, offline-first application, three-dimensional avatar, caregiver safety.

---

## 2. Introduction

Dementia and Alzheimer's disease affect memory, orientation, communication, recognition, and daily independence. A person may forget the identity of a family member, repeat the same question, become anxious in unfamiliar situations, or need assistance with medicines and appointments. Families and caregivers provide essential support, but they may not be available continuously because of work, distance, or other responsibilities.

Existing digital assistants can answer questions and provide reminders, but most are designed as general-purpose tools. They may not understand the emotional importance of a familiar face and voice. A generic assistant can also feel unfamiliar or clinical to an elderly person. A more suitable system should provide simple interaction, patient responses, familiar cues, gentle reminders, and a safety connection to caregivers.

Factech AI addresses this requirement by creating a digital representation of a trusted loved one. The caregiver configures the companion once, after which the patient can communicate with it through a simple avatar-centred interface. The system uses persona information and selected memories to produce context-aware responses. It does not treat repetition as a failure; instead, it is designed to remain calm and supportive.

The platform has two complementary purposes. First, it provides companionship and memory assistance through a familiar digital presence. Second, it provides practical care support through medication reminders, family contacts, wellbeing observations, and emergency communication. The system is designed with local processing and privacy in mind so that sensitive photographs, voice samples, and personal memories can remain under the user's control whenever possible.

Factech AI is not intended to replace doctors, nurses, caregivers, or family members. Its purpose is to provide an additional layer of comfort, orientation, routine assistance, and communication. Clinical decisions and emergency decisions must remain with qualified people and appropriate emergency services.

---

## 3. Literature Review

Traditional dementia-support technologies commonly focus on reminders, calendars, GPS tracking, medication schedules, or basic communication. These tools can support routine activities, but they generally do not combine personal identity, emotional familiarity, conversation, and caregiver monitoring in one interface. Reminder-only systems may notify a user about an event without explaining it in a familiar voice or relating it to the person's daily context.

Conversational artificial intelligence has introduced new possibilities for personalised assistance. Large language models can generate natural-language responses, explain information, and maintain a conversational style. However, a generic language model may produce responses that are too long, impersonal, or unsuitable for a person with cognitive difficulties. It may also provide incorrect information. For this reason, Factech AI uses persona instructions, selected memories, temporal context, and caregiver-defined care plans to make responses more consistent and dementia-safe. The system also preserves the role of caregivers rather than presenting AI as a replacement for human care.

Computer vision and face-recognition technologies can assist with identity and object recall. In a dementia-care context, a camera can help identify a familiar person or a personal item such as keys or medicine. Such functionality must be used carefully because facial data and photographs are sensitive personal information. Factech AI therefore treats recognition as an assistance feature and keeps the caregiver responsible for enrollment and interpretation.

Speech technologies can make interaction more accessible to elderly users. Speech recognition allows hands-free conversation, while text-to-speech allows the companion to speak responses. A familiar voice may provide stronger emotional recognition than text alone. Factech AI supports neural speech and optional local voice-cloning engines, with explicit consent required for the use of a real person's voice sample.

Animated photographs and three-dimensional avatars can provide visual continuity. A talking photo preserves the recognisable photograph, while a generated three-dimensional face can provide a more interactive presentation. Lip synchronisation driven by the speech signal improves the perception that the companion is speaking. These visual features must remain lightweight and must not obstruct essential controls, especially on mobile devices.

The reviewed concepts indicate a need for an integrated, privacy-aware platform that combines familiar identity cues, conversational assistance, memory retrieval, routine reminders, safety contacts, and caregiver support. Factech AI is proposed as such an integrated system.

---

## 4. Problem Statement and Objectives

### 4.1 Problem Statement

People living with dementia may experience memory loss, confusion, loneliness, repetition, agitation, and difficulty following daily routines. They may not recognise a family member or remember where an important object was placed. Families and caregivers cannot always remain available to answer repeated questions, provide reassurance, announce medication times, or respond immediately to a distress situation.

Existing applications often separate these needs into different tools. One application may provide reminders, another may store photographs, and another may provide a generic chatbot. These systems may be difficult for an elderly person to use and may not provide a familiar, emotionally reassuring interaction. There is therefore a need for a unified system that can offer a recognisable companion, context-aware memory assistance, gentle routine support, and a direct connection to family members while protecting sensitive personal data.

### 4.2 Objectives

The primary objective of Factech AI is to develop a privacy-first AI memory companion that supports dementia care through familiar, multimodal, and accessible interaction.

The major objectives are:

1. **Personalised companion creation:** Allow a caregiver to configure a loved one's name, relationship, personality, language, photograph, voice, memories, and care plan.
2. **In-character conversation:** Generate warm, patient, and context-aware responses using persona information and relevant memories.
3. **Long-term memory assistance:** Store and retrieve useful episodic facts from previous conversations and caregiver-provided memories.
4. **Familiar visual interaction:** Provide a real photograph, talking photograph, or lip-synchronised three-dimensional face.
5. **Voice-based accessibility:** Support speech input where available and produce spoken responses using Android or local voice technology.
6. **Face and object recognition:** Assist with recognising enrolled people and personal objects.
7. **Routine and medication support:** Provide reminders for medicine, meals, appointments, and events using gentle announcements.
8. **Family safety:** Provide quick access to emergency contacts and support caregiver-managed family updates and SOS workflows.
9. **Caregiver insights:** Provide non-clinical summaries of engagement, mood indicators, topics, and possible concerns from recent conversations.
10. **Privacy and consent:** Avoid exposing API keys in the frontend, use explicit consent for sensitive features, and keep data local where possible.
11. **Offline-first Android support:** Allow profile, persona, memories, conversations, reminders, family contacts, settings, and cached avatar data to remain available without a localhost backend.
12. **Accessible mobile experience:** Support readable text, high contrast, reduced motion, safe-area spacing, large touch targets, keyboard-safe inputs, and responsive layouts.

---

## 5. Hypothesis and Methodology

### 5.1 Hypothesis

**A familiar AI companion that combines personalised identity, voice, visual presence, episodic memory, routine reminders, and caregiver safety features can improve the accessibility, continuity, and emotional usefulness of digital support for people living with dementia, while a privacy-first local architecture can reduce unnecessary dependence on external services.**

### 5.2 Methodology

#### A. User and caregiver configuration

The caregiver enters the patient's profile and creates one companion persona. The persona contains the loved one's name, relationship, personality, age, language, accent, conversation style, photograph, optional voice sample, and care plan. The care plan can include routines, comforting subjects, topics to avoid, known triggers, calming strategies, and anchor answers for repeated questions.

#### B. Conversation and persona intelligence

When the patient sends a message, the system builds a controlled context containing the persona, user identity, recent conversation, relevant episodic memories, time-of-day information, and applicable care-plan rules. The online path sends this context to the configured backend language model. The offline path uses a locally cached small model when the user has enabled Offline AI or when the device is disconnected. The response is returned to the same conversation interface and saved locally.

#### C. Episodic memory

Useful facts from completed conversations can be distilled into short memory statements. Vector embeddings are used by the backend Qdrant store for semantic retrieval. The Android local-first layer mirrors application state into SQLite, including conversations, messages, memories, reminders, family contacts, preferences, and pending synchronization data. The user can export or delete data through the settings interface.

#### D. Face and object recognition

A caregiver can enroll a person or object with a photograph and descriptive information. The backend generates visual embeddings and stores metadata. During recognition, a captured image is compared with enrolled embeddings. The system returns a recognised identity or object only when the confidence threshold is appropriate; otherwise, it reports that the item could not be confidently identified.

#### E. Avatar and visual feedback

The avatar interface can display the enrolled photograph, an animated talking photograph, or a generated three-dimensional face. The speech amplitude drives lip movement and voice-wave feedback. The mobile layout keeps the avatar area, action controls, transcript, suggestions, input field, and bottom navigation in separate responsive regions so that controls do not cover the avatar or one another.

#### F. Voice and speech

Speech recognition is used where the Android or browser environment supports it. Text-to-speech uses Android-compatible or browser speech synthesis for offline playback where possible. Optional local OpenVoice and XTTS workers provide voice cloning and multilingual speech on supported local hardware. A real person's voice is used only with appropriate caregiver consent.

#### G. Reminders and safety

Reminders are stored locally and include category, title, time, frequency, description, enabled state, and completion status. Family contacts are available offline for quick dialing. External family notifications are sent only when network access is available; otherwise, the event is marked pending and remains queued for synchronization. The system must never claim that an external notification was sent when it was not delivered.

#### H. Android and local-first architecture

The frontend is packaged using Capacitor into the existing Android project. Capacitor SQLite provides a native database with schema versioning, primary keys, timestamps, entity tables, settings, and a synchronization queue. Local storage remains a fallback for unsupported browser environments. Production API access is configured through an environment variable and must use HTTPS rather than localhost or 127.0.0.1.

#### I. Testing methodology

Testing includes frontend production builds, Android Gradle builds, responsive viewport checks, local database create/read/update/delete operations, persistence after restart, offline conversation with network disabled, online conversation, reminder operations, family-contact operations, camera permission handling, speech and Android TTS support, avatar rendering, and error handling. Offline AI is considered successful only after a real local model generates a response without a network request.

---

## 6. Results

The Factech AI implementation provides an integrated dementia-care companion experience with the following results:

1. **Personalised persona:** A caregiver can configure a companion representing a loved one through identity, relationship, personality, language, memories, photograph, voice, and care-plan information.
2. **Context-aware conversation:** The companion can respond in a warm, in-character manner and use recent conversation and retrieved memories as context.
3. **Multilingual support:** The conversation and voice architecture supports English, Hindi, and Hinglish flows.
4. **Memory support:** The platform includes photo and text memories, reminiscence interaction, episodic memory retrieval, and local conversation persistence.
5. **Visual companion:** The application supports real photographs, talking photographs, and three-dimensional avatar rendering with speech-driven mouth movement.
6. **Recognition assistance:** The camera workflows support face enrollment, person recognition, object enrollment, and personal-object recall through the backend recognition services.
7. **Routine support:** Medication, meal, appointment, and event reminders can be created, announced, completed, skipped, or snoozed.
8. **Family safety:** Emergency contacts support primary-contact selection, quick dialing, contact management, family update preferences, update history, and SOS workflows.
9. **Caregiver awareness:** Recent conversations can be evaluated for non-clinical engagement and wellbeing insights without presenting a medical diagnosis.
10. **Accessibility:** The interface includes scalable text, high contrast, reduced motion, captions, large touch targets, and mobile safe-area handling.
11. **Offline-first Android foundation:** The Android application includes Capacitor SQLite integration, a versioned local schema, local state hydration, write-through persistence, and a pending synchronization table.
12. **Offline AI:** A locally cached Apache-2.0 model, `Xenova/LaMini-Flan-T5-77M`, can generate a real response through the Transformers.js WASM runtime after its first download. During an offline test, the model generated a response while producing zero new persona-chat API requests.
13. **Android packaging:** The existing Capacitor Android project builds successfully with the Gradle wrapper and produces a debug APK.

The system demonstrates that a familiar, multimodal companion can combine emotional support, memory assistance, routine support, and caregiver safety in one application. It also demonstrates that the core conversation state and a local AI path can be separated from the Python backend for offline use.

---

## 7. Conclusion and Future Work

### 7.1 Conclusion

Factech AI presents a privacy-first approach to AI-assisted dementia care. Instead of providing only a generic chatbot or a reminder list, it creates a familiar companion based on a loved one's identity, voice, photograph, personality, and shared memories. This design aims to make interaction more recognisable, patient, and emotionally meaningful for people who may experience confusion, loneliness, repetition, or difficulty with ordinary digital interfaces.

The platform combines persona-based conversation, episodic memory, face and object recognition, talking-photo and three-dimensional avatar presentation, voice interaction, reminders, family contacts, caregiver insights, and Android packaging. The local-first architecture preserves important user state on the device and allows an offline AI model to generate responses without localhost, Ollama, a hosted FastAPI server, or an external API after model setup.

Factech AI is an assistive system and must not be treated as a medical diagnostic or emergency replacement. Its safest use is as a companion and support layer alongside caregivers, healthcare professionals, and established emergency services. Explicit consent, transparent status labels, secure storage, and careful handling of voice and face data remain essential for responsible deployment.

### 7.2 Future Work

Future improvements may include:

1. Native Android on-device inference using an optimised llama.cpp or MediaPipe LLM bridge for better mobile performance and larger model choices.
2. A clearer first-run offline model download screen with progress, storage size, deletion, and hardware compatibility checks.
3. Full native offline speech recognition and improved Android TTS language coverage.
4. Background reminder notifications using Android notification channels and exact scheduling where permission is granted.
5. Secure token storage and a complete authentication system for caregivers and multiple devices.
6. Deterministic encrypted synchronization between local SQLite and a production HTTPS API.
7. Encryption at rest, consent records, retention controls, audit logs, and a formal health-data privacy review.
8. More efficient avatar rendering, low-memory device profiles, texture compression, and adaptive frame rates.
9. Broader testing on physical Android devices across screen sizes, Android versions, memory limits, and network conditions.
10. Clinician-reviewed dementia-safety evaluation, usability studies with caregivers, and non-diagnostic outcome measurements.
11. Additional features such as guided reminiscence sessions, personalised activity suggestions, caregiver dashboards, and improved family notification delivery.
12. Signed release builds and a production deployment process with managed secrets, monitoring, backups, and incident response.

---

## 8. References

1. React Documentation. *React: A JavaScript Library for Building User Interfaces*.
2. Vite Documentation. *Vite: Next Generation Frontend Tooling*.
3. Capacitor Documentation. *Capacitor: Cross-Platform Native Runtime for Web Apps*.
4. Capacitor Community. *SQLite Plugin Documentation*.
5. FastAPI Documentation. *FastAPI: Modern, Fast Web Framework for Building APIs with Python*.
6. Qdrant Documentation. *Vector Database and Semantic Search Documentation*.
7. Google AI Edge / MediaPipe Documentation. *Face Landmarker and On-Device Machine Learning*.
8. OpenVoice Documentation and Repository. *Open-Source Voice Cloning and Tone-Color Conversion*.
9. Coqui TTS / XTTS Documentation. *Multilingual Text-to-Speech and Voice Cloning*.
10. Hugging Face. *Transformers.js Documentation*.
11. Hugging Face Model Card. *Xenova/LaMini-Flan-T5-77M*, Apache-2.0 license.
12. ONNX Runtime Documentation. *Open Neural Network Exchange Runtime*.
13. Three.js Documentation. *JavaScript 3D Rendering Library*.
14. Android Developers Documentation. *Android App Architecture, Storage, Permissions, and Accessibility*.
15. World Health Organization. *Dementia: Key Facts and Public Health Guidance*.
16. National Institute on Aging. *What Is Dementia? Symptoms, Types, and Care Information*.
17. Mozilla Developer Network. *Web APIs, Web Storage, Media Capture, and Speech Interfaces*.
18. Factech AI project documentation. *Project Overview, Architecture, and Production Roadmap*.
