import { useState } from 'react'
import { useCamera } from '../hooks/useCamera.js'
import { recognizeObject } from '../api/client.js'

export default function ObjectScan() {
  const cam = useCamera()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  async function scan() {
    setBusy(true)
    setError(null)
    try {
      const blob = await cam.capture()
      if (!blob) {
        setError('Turn on the camera first.')
        return
      }
      setData(await recognizeObject(blob))
    } catch (e) {
      setError(e?.message || 'Scan failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1>Object Scan</h1>

      <div className="camera-wrap">
        <video ref={cam.videoRef} className="camera" muted playsInline />
        {!cam.active && (
          <button className="btn" onClick={cam.start}>📷 Turn on camera</button>
        )}
        {cam.error && <p className="error">{cam.error}</p>}
      </div>

      <button className="btn big" onClick={scan} disabled={busy || !cam.active}>
        🔍 Scan what I'm looking at
      </button>

      {busy && <p className="muted">Looking…</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <div className="results">
          {data.backend === 'fallback' && (
            <p className="hint">
              Object detection model not installed (dev mode) — install <code>requirements-ml.txt</code> for YOLOv8.
            </p>
          )}
          {data.detections?.length ? (
            <ul className="detection-list">
              {data.detections.map((d, i) => (
                <li key={i} className="detection">
                  <span className="det-label">{d.label}</span>
                  <span className="det-conf">{Math.round(d.confidence * 100)}%</span>
                  {d.remembered_location && (
                    <span className="det-loc">📍 {d.remembered_location}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No objects detected.</p>
          )}
        </div>
      )}
    </div>
  )
}
