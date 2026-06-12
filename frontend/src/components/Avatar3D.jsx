import React, { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Center, Bounds, Html } from '@react-three/drei';

function Model({ isSpeaking, src }) {
    const { scene } = useGLTF(src);
    const ref = useRef();

    useFrame((s, delta) => {
        if (!ref.current) return;
        // Gentle constant turn; livelier bob/sway while speaking.
        ref.current.rotation.y += delta * (isSpeaking ? 0.5 : 0.25);
        const t = s.clock.elapsedTime;
        ref.current.position.y = Math.sin(t * (isSpeaking ? 6 : 2)) * (isSpeaking ? 0.05 : 0.02);
        ref.current.rotation.z = Math.sin(t * (isSpeaking ? 4 : 1.2)) * (isSpeaking ? 0.04 : 0.01);
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

export default function Avatar3D({ isSpeaking = false, src = '/model.glb' }) {
    return (
        <Canvas
            camera={{ position: [0, 0, 5], fov: 40 }}
            style={{ width: '100%', height: '100%' }}
            dpr={[1, 2]}
        >
            {/* Lights only (no CDN HDR) so the model is always visible offline. */}
            <ambientLight intensity={1.1} />
            <hemisphereLight intensity={0.6} groundColor="#1e1b4b" />
            <directionalLight position={[3, 5, 4]} intensity={1.4} />
            <directionalLight position={[-4, 2, -2]} intensity={0.6} color="#8b5cf6" />
            <pointLight position={[0, 1, 3]} intensity={0.8} />
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

useGLTF.preload('/model.glb');
