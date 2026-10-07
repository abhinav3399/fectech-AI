/**
 * faceMeshProvider.js
 * Abstract interface for any face-mesh provider (MediaPipe Web, ML Kit Android, etc.)
 * The renderer never depends on a specific provider — swap by changing one import.
 */

/**
 * Normalized face mesh data emitted each frame.
 * @typedef {Object} FaceMeshFrame
 * @property {{ x: number, y: number, z: number }[]} points  478 normalized 3-D landmarks
 * @property {[number,number,number][]} triangles             ~952 triangle index triples
 * @property {number} timestamp                               performance.now() at capture
 * @property {{ originX:number, originY:number, width:number, height:number }|null} faceBounds
 */

export class FaceMeshProvider {
    /** @param {HTMLVideoElement} videoEl */
    async start(videoEl) {
        throw new Error('FaceMeshProvider.start() must be implemented');
    }

    stop() {}

    /**
     * Register a callback that receives a FaceMeshFrame each detected frame.
     * Only the latest frame is delivered (no queue build-up).
     * @param {(frame: FaceMeshFrame) => void} callback
     */
    onFrame(callback) {
        this._onFrame = callback;
    }

    /** @protected */
    _emit(frame) {
        if (this._onFrame) this._onFrame(frame);
    }
}

/**
 * Camera status values used across the UI.
 */
export const CameraStatus = {
    IDLE:          'idle',
    INITIALIZING:  'initializing',
    PERMISSION_DENIED: 'permission-denied',
    NO_CAMERA:     'no-camera',
    DETECTING:     'detecting',
    DETECTED:      'detected',
    TOO_FAR:       'too-far',
    MULTIPLE:      'multiple-faces',
    ERROR:         'error',
};
