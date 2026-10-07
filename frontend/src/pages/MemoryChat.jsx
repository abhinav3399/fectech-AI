import { useState } from 'react'
import { useCamera } from '../hooks/useCamera.js'
import { agentAnswer, transcribe } from '../api/client.js'
import TierBadge from '../components/TierBadge.jsx'

function speak(text) {
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    window.speechSynthesis.speak(u)
  } catch {
    /* speechSynthesis unavailable — ignore */
  }
}

export default function MemoryChat() {
  const cam = useCamera()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [recorder, setRecorder] = useState(null)
  const [recording, setRecording] = useState(false)

  async function ask(message) {
    if (!message) return
    setBusy(true)
    setError(null)
    try {
      const imageBlob = cam.active ? await cam.capture() : null
      const res = await agentAnswer({ message, imageBlob })
      setResult(res)
      speak(res.reply)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setBusy(true)
        try {
          const said = await transcribe(blob)
          if (said) {
            setText(said)
            await ask(said)
          } else {
            setError('No speech detected (set GROQ_API_KEY to enable voice).')
          }
        } catch (e) {
          setError(e?.message || 'Transcription failed')
        } finally {
          setBusy(false)
        }
      }
      mr.start()
      setRecorder(mr)
      setRecording(true)
    } catch {
      setError('Microphone unavailable.')
    }
  }

  function stopRecording() {
    recorder?.stop()
    setRecording(false)
  }

  return (
    <div className="page">
      <h1>Memory Chat</h1>

      <div className="camera-wrap">
        <video ref={cam.videoRef} className="camera" muted playsInline />
        {!cam.active && (
          <button className="btn" onClick={cam.start}>📷 Turn on camera</button>
        )}
        {cam.error && <p className="error">{cam.error}</p>}
      </div>

      <div className="ask-row">
        <button
          className={`btn big ${recording ? 'recording' : ''}`}
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
        >
          {recording ? '⏹ Stop & ask' : '🎤 Hold a moment, then speak'}
        </button>
      </div>

      <form
        className="text-row"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <input
          className="input"
          placeholder='Or type: "Who is this?"'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" disabled={busy || !text}>Ask</button>
      </form>

      {busy && <p className="muted">Thinking…</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className={`answer ${result.identify ? `answer-${result.tier}` : 'answer-chat'}`}>
          {(result.identify || result.candidate) && (
            <div className="answer-head">
              {result.identify && <TierBadge tier={result.tier} p={result.p} />}
              {result.candidate && <strong className="who">{result.candidate}</strong>}
            </div>
          )}
          <p className="reply">{result.reply}</p>
          {result.identify && result.tier === 'medium' && (
            <p className="hint">🤔 Not certain — ask your caregiver to confirm in the dashboard.</p>
          )}
        </div>
      )}
    </div>
  )
}
