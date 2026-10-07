# Android local AI and Ollama

## Important limitation

The Factech AI APK can connect to a local Ollama-compatible API, but it does not install or bundle the Ollama server or model weights. Official Ollama downloads currently target desktop/server platforms; Android hosting requires a separate Android runtime or community implementation. Check its source, permissions, and API behavior before installing a third-party runtime.

## Connect a phone-local server

1. Install and start an Android local inference runtime separately. It must expose the Ollama HTTP API routes `/api/tags` and `/api/chat` on the same phone.
2. In Factech AI, open **More → Settings → AI mode**.
3. Choose **Ollama** to require the local service, or **Auto** to try phone-local Ollama, then the configured backend, then the Transformers.js model.
4. Set **Ollama server URL** to the address shown by the runtime. For a service bound to the phone loopback this is usually `http://127.0.0.1:11434`.
5. Enter the exact installed model tag (for example, `llama3.2:3b`) and tap **Test connection**. Save the settings after the test.

If the server is running in Termux or another isolated environment, it may use a different address or port. Use the endpoint that runtime documents; `127.0.0.1` is correct only when the server is reachable from the Android app's loopback interface.

## Offline fallback

The bundled web app can also run `Xenova/LaMini-Flan-T5-77M` through Transformers.js. It is downloaded on first use and cached by the WebView; that initial download needs internet, and the model is small. Use **Offline** to skip Ollama and the backend. **Auto** uses it as the final fallback.

## Diagnostics

- **Could not connect**: start the Android inference server and confirm its URL/port.
- **Model is not installed**: use an exact model tag reported by the server's `/api/tags` endpoint.
- **Auto falls back to the backend**: Auto still attempts the configured backend after local Ollama cannot answer; select **Ollama** to force local-only requests.
- The phone-local Ollama chat call uses Android's native HTTP bridge, so WebView CORS is not required. HTTP still requires the Android cleartext setting already present in this debug-oriented build; use HTTPS for public endpoints.
