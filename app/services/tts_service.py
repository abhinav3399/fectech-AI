
import edge_tts
import pygame
import asyncio
import os
import time

# Voice Configuration
# en-IN-NeerjaNeural (Female)
# en-IN-PrabhatNeural (Male)
VOICE = "en-IN-NeerjaNeural"

class TTSService:
    def __init__(self):
        try:
            pygame.mixer.init()
        except Exception as e:
            print(f"⚠️ Audio Init Failed (No device?): {e}")

    async def speak(self, text: str):
        """Generates and plays audio for the given text."""
        print(f"🗣️ Speaking: {text}")
        if not text:
            return

        filename = f"speech_{int(time.time())}.mp3"
        try:
            communicate = edge_tts.Communicate(text, VOICE)
            await communicate.save(filename)
            
            # Play
            if pygame.mixer.get_init():
                pygame.mixer.music.load(filename)
                pygame.mixer.music.play()
                
                # Wait until finished
                # Note: This blocks the async loop logic if we just loop. 
                # We use asyncio.sleep to yield.
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
                    
                pygame.mixer.music.unload()
            else:
                print("🔇 Audio mixer not initialized, skipping playback.")

        except Exception as e:
            print(f"❌ TTS Error: {e}")
        finally:
            # Cleanup
            if os.path.exists(filename):
                try:
                    os.remove(filename)
                except:
                    pass

    async def synthesize(self, text: str, voice: str = None) -> str:
        """Generate neural TTS and return base64-encoded MP3 for the browser
        to play (no server-side audio device needed).

        edge-tts intermittently returns "No audio was received", so retry a few
        times before giving up.
        """
        import base64
        import tempfile
        if not text:
            return None
        voice = voice or VOICE
        last_err = None
        for attempt in range(3):
            tmp = os.path.join(tempfile.gettempdir(), f"tts_{int(time.time() * 1000)}_{attempt}.mp3")
            try:
                communicate = edge_tts.Communicate(text, voice)
                await communicate.save(tmp)
                if os.path.exists(tmp) and os.path.getsize(tmp) > 0:
                    with open(tmp, "rb") as f:
                        data = f.read()
                    return base64.b64encode(data).decode("utf-8")
            except Exception as e:
                last_err = e
            finally:
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except:
                        pass
            await asyncio.sleep(0.4)
        print(f"❌ TTS synth error after retries: {last_err}")
        return None

tts_service = TTSService()
