import React, { Suspense, useRef, useEffect, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Center, Bounds, Html } from '@react-three/drei';
import { getLevel, getMouthSignal } from '../lib/audiolevel';

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
    const mouth = useRef(null);

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

    useFrame((s, delta) => {
        const r = ref.current;
        if (r) {
            const t = s.clock.elapsedTime;
            const lv = isSpeaking ? getLevel() : 0;
            // Rest at a ~30° (3/4) view so the head reads as dimensional, not dead-flat;
            // the talking sway is a gentle motion AROUND that angle (never swings to front-on).
            const REST_YAW = 0.5; // ~28°
            r.rotation.y = REST_YAW + Math.sin(t * (isSpeaking ? 1.0 : 0.55)) * (isSpeaking ? 0.12 : 0.08);
            r.rotation.x = lv * 0.05;
            r.position.y = Math.sin(t * (isSpeaking ? 5 : 2)) * (isSpeaking ? 0.03 : 0.02);
            r.rotation.z = Math.sin(t * (isSpeaking ? 3 : 1.2)) * (isSpeaking ? 0.03 : 0.01);
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

    return <primitive ref={ref} object={scene} />;
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
            camera={{ position: [0, 0, 5], fov: 38 }}
            style={{ width: '100%', height: '100%' }}
            dpr={[1, 2.5]}
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
                {/* key={src} re-fits Bounds when the model changes (generated mesh). */}
                <Bounds key={src} fit margin={1.2}>
                    <Center>
                        <Model isSpeaking={isSpeaking} src={src} />
                    </Center>
                </Bounds>
            </Suspense>
            <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} />
        </Canvas>
    );
}

export default function Avatar3D({ isSpeaking = false, src = '/model.glb' }) {
    const fallback = (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
            <div style={{ color: '#94a3b8', fontFamily: 'system-ui', maxWidth: 320, lineHeight: 1.5 }}>
                Couldn't display this 3D model. Switch back to the photo (the faithful likeness), or regenerate it from the Edit screen.
            </div>
        </div>
    );
    return (
        <GLBErrorBoundary key={src} fallback={fallback}>
            <Stage isSpeaking={isSpeaking} src={src} />
        </GLBErrorBoundary>
    );
}

useGLTF.preload('/model.glb');
