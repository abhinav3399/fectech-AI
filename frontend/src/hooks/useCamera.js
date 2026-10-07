import { useEffect, useRef, useState } from 'react'

/** Shared webcam helper: start/stop the stream and capture a JPEG frame as a Blob. */
export function useCamera() {
  const videoRef = useRef(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState(null)

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
    } catch (e) {
      setError(e?.message || 'Camera unavailable')
    }
  }

  function stop() {
    const stream = videoRef.current?.srcObject
    stream?.getTracks?.().forEach((t) => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }

  useEffect(() => () => stop(), [])

  async function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  }

  return { videoRef, active, error, start, stop, capture }
}
