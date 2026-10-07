import React, { Suspense, useRef, useEffect, useLayoutEffect, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { getLevel, getMouthSignal } from '../lib/audiolevel';
import { backendAssetUrl } from '../lib/apiConfig';

// The backend deliberately returns generated files as `/static/models/...` so a
// web deployment stays same-origin.  In Capacitor, however, that path would be
// resolved against the WebView's own `http://localhost`, not the LAN/HTTPS API
// server.  Turn only backend-relative model paths into an absolute API origin.
function resolveModelUrl(src) {
    if (!src || /^(?:https?:|blob:|data:)/i.test(src)) return src;
    try {
        return backendAssetUrl(src);
    } catch {
        return src;
    }
}

// A failed/unreachable GLB must NEVER crash the whole app — catch it and show a
// gentle fallback instead. key={src} resets it when the model changes.
class GLBErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(err) { console.warn('Avatar3D: could not load model —', err?.message || err); }
    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function Model({ isSpeaking, src }) {
    const { scene } = useGLTF(src);
    const ref = useRef();
    const fitRef = useRef();
    const mouth = useRef(null);
    const rig = useRef(null);
    const blink = useRef({ next: 3.1, started: -1 });

    // Providers export in different units (the local face mesh uses millimetres,
    // while many hosted GLBs use metres).  Bounds can miss an asynchronously
    // loaded scene on some WebGL browsers, leaving a millimetre-sized face
    // filling the whole viewport. Normalize every loaded model ourselves.
    useLayoutEffect(() => {
        const group = fitRef.current;
        if (!group) return;
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const longestSide = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(longestSide) || longestSide <= 0) return;
        const scale = 2.35 / longestSide;
        group.scale.setScalar(scale);
        // Apply the center offset in the same local units as the scaled scene.
        group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    }, [scene]);

    // Find the face mesh's lip-sync metadata (baked into the GLB by facemesh3d)
    // once, and cache the pristine vertex positions to deform from / return to.
    useEffect(() => {
        let mesh = null;
        scene.traverse((o) => { if (!mesh && o.isMesh && o.userData && o.userData.mouth) mesh = o; });
        if (!mesh) { mouth.current = null; return; }
        const m = mesh.userData.mouth;
        const pos = mesh.geometry.attributes.position;
        mouth.current = {
            geom: mesh.geometry, pos,
            rest: pos.array.slice(0),
            idx: m.indices, w: m.weights, lower: m.lower,
            ax: m.openAxis || [0, -1, 0], cx: (m.center && m.center[0]) || 0,
            open: 0, wide: 0, dirty: false, frame: 0,
        };
        return () => {              // restore the resting mouth when the model unmounts
            const M = mouth.current;
            if (M) { try { M.pos.array.set(M.rest); M.pos.needsUpdate = true; M.geom.computeVertexNormals(); } catch (e) { /* noop */ } }
        };
    }, [scene]);

    useEffect(() => {
        const targets = [];
        scene.traverse((o) => {
            if (o.isMesh) {
                const materials = Array.isArray(o.material) ? o.material : [o.material];
                materials.filter(Boolean).forEach((material) => { material.side = THREE.DoubleSide; });
            }
            if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
            targets.push(o);
        });
        rig.current = targets.length ? targets : null;
        return () => { rig.current = null; };
    }, [scene]);

    const setMorph = (name, value) => {
        for (const mesh of rig.current || []) {
            const index = mesh.morphTargetDictionary[name];
            if (index !== undefined) mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, value));
        }
    };

    useFrame((s, delta) => {
        const r = ref.current;
        if (r) {
            const t = s.clock.elapsedTime;
            const lv = isSpeaking ? getLevel() : 0;
            // Keep the identity texture facing the user; only add a tiny natural sway.
            r.rotation.y = Math.sin(t * (isSpeaking ? 1.0 : 0.55)) * (isSpeaking ? 0.06 : 0.03);
            r.rotation.x = lv * 0.05;
            r.position.y = Math.sin(t * (isSpeaking ? 5 : 2)) * (isSpeaking ? 0.03 : 0.02);
            r.rotation.z = Math.sin(t * (isSpeaking ? 3 : 1.2)) * (isSpeaking ? 0.03 : 0.01);
        }

        // Drive ARKit-compatible morph targets when the exported asset contains a
        // facial rig. The signal is measured from the actual playing TTS audio.
        if (rig.current) {
            const t = s.clock.elapsedTime;
            const sig = isSpeaking ? getMouthSignal() : { open: 0, wide: 0, round: 0 };
            const now = t;
            const state = blink.current;
            if (state.started < 0 && now >= state.next) state.started = now;
            const blinkProgress = state.started >= 0 ? Math.min(1, (now - state.started) / 0.16) : 0;
            const blinkWeight = state.started >= 0
                ? (blinkProgress < 0.5 ? blinkProgress * 2 : (1 - blinkProgress) * 2)
                : 0;
            if (state.started >= 0 && blinkProgress >= 1) {
                state.started = -1;
                state.next = now + 2.7 + (Math.sin(now * 1.7) + 1) * 1.8;
            }
            setMorph('jawOpen', sig.open * 0.72);
            setMorph('mouthOpen', sig.open * 0.62);
            setMorph('mouthSmileLeft', sig.wide * 0.16);
            setMorph('mouthSmileRight', sig.wide * 0.16);
            setMorph('mouthFunnel', sig.round * 0.38);
            setMorph('eyeBlinkLeft', blinkWeight);
            setMorph('eyeBlinkRight', Math.max(0, blinkWeight * (0.92 + Math.sin(now * 2.1) * 0.08)));
            setMorph('eyeLookUpLeft', Math.max(0, Math.sin(now * 0.37)) * 0.08);
            setMorph('eyeLookUpRight', Math.max(0, Math.sin(now * 0.37)) * 0.08);
            setMorph('eyeLookDownLeft', Math.max(0, -Math.sin(now * 0.37)) * 0.05);
            setMorph('eyeLookDownRight', Math.max(0, -Math.sin(now * 0.37)) * 0.05);
            setMorph('browInnerUp', sig.open * 0.05);
            setMorph('cheekSquintLeft', sig.wide * 0.08);
            setMorph('cheekSquintRight', sig.wide * 0.08);
        }

        // Lip-sync: deform the mouth vertices to the live voice (viseme-like approximation).
        const M = mouth.current;
        if (!M) return;
        const sig = isSpeaking ? getMouthSignal() : { open: 0, wide: 0 };
        // Frame-rate-independent smoothing; close a touch faster than we open so the
        // mouth settles to rest within ~150ms when the voice stops.
        M.open += (sig.open - M.open) * Math.min(1, delta * (sig.open < M.open ? 22 : 16));
        M.wide += ((sig.wide || 0) - M.wide) * Math.min(1, delta * 14);

        if (!(M.open > 0.003 || M.wide > 0.01 || M.dirty)) return; // idle when closed -> no writes
        const MAX_OPEN = 3.2, MAX_WIDE = 1.1;           // mm on a ~110mm face — small + smooth, no tearing
        const a = M.pos.array, rest = M.rest, idx = M.idx, w = M.w, low = M.lower, ax = M.ax, cx = M.cx;
        for (let n = 0; n < idx.length; n++) {
            const o = idx[n] * 3;
            // Lower lip + chin drop = jaw open (voiced energy); a tiny corner spread =
            // lip width (formant energy) so vowels vs consonants look different. Upper lip stays.
            const drop = (low[n] ? 1 : 0) * M.open * w[n] * MAX_OPEN;
            const spread = Math.sign(rest[o] - cx) * M.wide * w[n] * MAX_WIDE;
            a[o] = rest[o] + ax[0] * drop + spread;
            a[o + 1] = rest[o + 1] + ax[1] * drop;
            a[o + 2] = rest[o + 2] + ax[2] * drop;
        }
        M.pos.needsUpdate = true;
        M.dirty = M.open > 0.003 || M.wide > 0.01;
        if ((M.frame = (M.frame + 1) % 2) === 0) M.geom.computeVertexNormals();   // throttle normals
    });

    return (
        <group ref={ref}>
            <group ref={fitRef}>
                <primitive object={scene} />
            </group>
        </group>
    );
}

function Loader() {
    return (
        <Html center>
            <div style={{ color: '#a78bfa', fontFamily: 'system-ui', fontSize: 14, whiteSpace: 'nowrap' }}>
                Loading avatar…
            </div>
        </Html>
    );
}

function Stage({ isSpeaking, src }) {
    return (
        <Canvas
            camera={{ position: [0, 0, 4.5], fov: 32, near: 0.01, far: 100 }}
            style={{ width: '100%', height: '100%' }}
            dpr={[1, 2]}
            flat                       // no tone-mapping -> the photo texture stays true & clear
            gl={{ antialias: true }}   // crisp edges on the low-poly mesh
        >
            {/* Even, soft studio lighting (no CDN HDR) — bright & clear, no harsh hotspots. */}
            <ambientLight intensity={1.05} />
            <hemisphereLight intensity={0.85} color="#ffffff" groundColor="#1e1b4b" />
            <directionalLight position={[0, 1.5, 5]} intensity={0.7} />              {/* soft frontal key */}
            <directionalLight position={[-4, 2, 2]} intensity={0.35} color="#dbeafe" /> {/* gentle cool fill */}
            <directionalLight position={[4, 1.5, 2]} intensity={0.3} />             {/* opposite fill, balances the key */}
            <Suspense fallback={<Loader />}>
                <Model key={src} isSpeaking={isSpeaking} src={src} />
            </Suspense>
            <OrbitControls enablePan={false} enableZoom minDistance={2.2} maxDistance={8} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} />
        </Canvas>
    );
}

export default function Avatar3D({ isSpeaking = false, src = null }) {
    const modelSrc = resolveModelUrl(src);
    const fallback = (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
            <div style={{ color: '#94a3b8', fontFamily: 'system-ui', maxWidth: 320, lineHeight: 1.5 }}>
                {src ? "Couldn't display this 3D model. Switch back to the photo or regenerate it from the Edit screen." : 'No generated 3D model yet. Generate one from the Edit screen.'}
            </div>
        </div>
    );
    if (!modelSrc) return fallback;
    return (
        <GLBErrorBoundary key={modelSrc} fallback={fallback}>
            <Stage isSpeaking={isSpeaking} src={modelSrc} />
        </GLBErrorBoundary>
    );
}
