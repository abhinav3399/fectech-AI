import axios from 'axios'
import { getBackendOrigin } from '../lib/apiConfig'

export const api = axios.create()
api.interceptors.request.use((config) => ({
  ...config,
  baseURL: getBackendOrigin() || undefined,
}))

export const listPeople = () => api.get('/api/people').then((r) => r.data)
export const listObjects = () => api.get('/api/objects').then((r) => r.data)

export function enrollPerson({ image, name, relationship, notes }) {
  const fd = new FormData()
  fd.append('image', image)
  fd.append('name', name)
  fd.append('relationship', relationship || '')
  fd.append('notes', notes || '')
  return api.post('/api/people', fd).then((r) => r.data)
}

export function enrollObject({ image, label, location, notes }) {
  const fd = new FormData()
  fd.append('image', image)
  fd.append('label', label)
  fd.append('location', location || '')
  fd.append('notes', notes || '')
  return api.post('/api/objects', fd).then((r) => r.data)
}

export function transcribe(audioBlob) {
  const fd = new FormData()
  fd.append('audio', audioBlob, 'speech.webm')
  return api.post('/api/transcribe', fd).then((r) => r.data.text)
}

export function agentAnswer({ message, imageBlob }) {
  const fd = new FormData()
  fd.append('message', message || '')
  if (imageBlob) fd.append('image', imageBlob, 'frame.jpg')
  return api.post('/agent/answer', fd).then((r) => r.data)
}

export function recognizeObject(imageBlob) {
  const fd = new FormData()
  fd.append('image', imageBlob, 'frame.jpg')
  return api.post('/api/recognize/object', fd).then((r) => r.data)
}

export const reviewQueue = () => api.get('/caregiver/review-queue').then((r) => r.data)

export function resolveReview(id, decision) {
  const fd = new FormData()
  fd.append('decision', decision)
  return api.post(`/caregiver/review/${id}`, fd).then((r) => r.data)
}
