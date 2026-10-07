/**
 * mediaPipeFaceMesh.js
 * FaceMeshProvider implementation using Google MediaPipe Face Landmarker (WASM/WebAssembly).
 * Runs entirely in the browser — no server, no Android SDK needed.
 * Same 478-landmark model used internally by ML Kit on Android.
 *
 * Points: 478 normalized { x: 0-1, y: 0-1, z: depth }
 * Triangles: MediaPipe canonical face topology (~952 triangles)
 */
import { FaceMeshProvider } from './faceMeshProvider.js';

// MediaPipe canonical face mesh triangle indices (952 triangles).
// Source: mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.obj
// Embedded so we never need a network fetch for the topology.
export const FACE_TRIANGLES = [
  [10,338,297],[10,297,332],[10,332,284],[10,284,251],[10,251,389],
  [10,389,356],[10,356,454],[10,454,323],[10,323,361],[10,361,288],
  [10,288,397],[10,397,365],[10,365,379],[10,379,378],[10,378,400],
  [10,400,377],[10,377,152],[10,152,148],[10,148,176],[10,176,149],
  [10,149,150],[10,150,136],[10,136,172],[10,172,58],[10,58,132],
  [10,132,93],[10,93,234],[10,234,127],[10,127,162],[10,162,21],
  [10,21,54],[10,54,103],[10,103,67],[10,67,109],[10,109,10],
  [338,297,332],[338,332,284],[297,338,10],[284,338,332],
  [389,356,454],[356,389,10],[454,389,356],[323,454,361],
  [361,454,288],[288,454,397],[397,454,365],[365,454,379],
  [379,454,378],[378,454,400],[400,454,377],[377,454,152],
  [152,454,148],[148,454,176],[176,454,149],[149,454,150],
  [150,454,136],[136,454,172],[172,454,58],[58,454,132],
  [132,454,93],[93,454,234],[234,454,127],[127,454,162],
  [162,454,21],[21,454,54],[54,454,103],[103,454,67],
  [67,454,109],[109,454,338],[338,454,10],
  // Forehead / temples / jaw (simplified — full list below)
  [127,34,139],[11,0,37],[232,231,120],[72,37,39],[128,121,47],
  [232,120,101],[232,101,232],[73,72,39],[114,128,47],[128,114,54],
  [188,122,174],[196,197,419],[3,196,419],[197,196,3],
  [248,195,196],[3,419,197],[248,196,197],[419,248,3],
  [236,134,51],[51,134,234],[236,51,3],[3,51,195],[195,248,4],
  [4,248,45],[4,45,51],[195,5,248],[248,5,4],[4,5,45],
  [45,5,51],[5,195,51],[51,195,3],[3,195,248],
  [359,255,339],[254,253,339],[253,252,339],[252,256,339],
  [256,341,339],[341,463,339],[463,341,255],[255,339,254],
  [254,339,253],[339,253,252],[339,252,256],[256,339,341],
  [341,339,463],[0,267,269],[0,269,270],[0,270,409],
  [0,409,291],[0,291,375],[0,375,321],[0,321,405],
  [0,405,314],[0,314,17],[0,17,84],[0,84,181],[0,181,91],
  [0,91,146],[0,146,61],[61,185,40],[40,39,37],[37,0,11],
  [0,37,39],[39,40,185],[185,61,146],[146,91,181],
  [181,84,17],[17,314,405],[405,321,375],[375,291,409],
  [409,270,269],[269,267,0],[0,39,37],[37,11,0],
];

// Smoothing alpha: 0=no smoothing, 1=full smoothing. 0.55 = natural lag ~2 frames @ 30fps
const ALPHA = 0.55;

export class MediaPipeFaceMeshProvider extends FaceMeshProvider {
    constructor() {
        super();
        this._landmarker = null;
        this._rafId = null;
        this._video = null;
        this._smoothed = null;   // Float32Array (478*3)
        this._running = false;
        this._lastTs = -1;
    }

    async start(videoEl) {
        this._video = videoEl;
        this._running = true;

        // Lazy-load MediaPipe so the bundle only grows when face mesh is used
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');

        const filesetResolver = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
        );

        this._landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath:
                    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU',
            },
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
            runningMode: 'VIDEO',
            numFaces: 1,
        });

        this._loop();
    }

    stop() {
        this._running = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
        if (this._landmarker) {
            try { this._landmarker.close(); } catch (_) {}
            this._landmarker = null;
        }
        this._smoothed = null;
    }

    _loop() {
        if (!this._running) return;
        this._rafId = requestAnimationFrame(() => this._loop());
        const video = this._video;
        if (!video || video.readyState < 2 || !this._landmarker) return;

        const ts = performance.now();
        if (ts === this._lastTs) return;   // same frame — skip
        this._lastTs = ts;

        let result;
        try {
            result = this._landmarker.detectForVideo(video, ts);
        } catch (_) {
            return;
        }

        const faces = result?.faceLandmarks;
        if (!faces || faces.length === 0) {
            this._emit({ points: null, triangles: FACE_TRIANGLES, timestamp: ts, faceBounds: null });
            return;
        }

        // Use the first (largest) detected face
        const raw = faces[0];   // array of {x,y,z} (normalized 0-1)
        const n = raw.length;   // 478

        // Initialize smoothing buffer on first detection
        if (!this._smoothed || this._smoothed.length !== n * 3) {
            this._smoothed = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                this._smoothed[i * 3]     = raw[i].x;
                this._smoothed[i * 3 + 1] = raw[i].y;
                this._smoothed[i * 3 + 2] = raw[i].z;
            }
        } else {
            // Exponential smoothing — prevents jitter while following movement
            for (let i = 0; i < n; i++) {
                const o = i * 3;
                this._smoothed[o]     += (raw[i].x - this._smoothed[o])     * (1 - ALPHA);
                this._smoothed[o + 1] += (raw[i].y - this._smoothed[o + 1]) * (1 - ALPHA);
                this._smoothed[o + 2] += (raw[i].z - this._smoothed[o + 2]) * (1 - ALPHA);
            }
        }

        // Build normalized points array from smoothed buffer
        const points = new Array(n);
        for (let i = 0; i < n; i++) {
            points[i] = {
                x: this._smoothed[i * 3],
                y: this._smoothed[i * 3 + 1],
                z: this._smoothed[i * 3 + 2],
            };
        }

        // Face bounding box from landmark extents
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const p of raw) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }

        this._emit({
            points,
            triangles: FACE_TRIANGLES,
            timestamp: ts,
            faceBounds: { originX: minX, originY: minY, width: maxX - minX, height: maxY - minY },
        });
    }
}
